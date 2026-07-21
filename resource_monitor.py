# custom_nodes/comfyui_inteliweb_nodes/resource_monitor.py
"""Lightweight hardware telemetry endpoint for the Inteliweb top-bar monitor.

This scanner-friendly implementation uses Python APIs and read-only operating
system telemetry files only. It never starts a shell or external process.

On Windows and non-containerized systems, CPU and RAM are read with psutil. On
Linux, cgroup v2/v1 telemetry is preferred when the process is containerized or
resource-limited, so Docker/RunPod/Vast report the container allocation rather
than the shared host. NVIDIA telemetry is read with NVML through pynvml;
PyTorch is used as a portable fallback for VRAM information.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

LOGGER = logging.getLogger(__name__)
MIB = 1024 * 1024
NVML_SAMPLE_WINDOW_US = 2_000_000
STATUS_CACHE_SECONDS = 0.25
MIN_CPU_SAMPLE_SECONDS = 0.10
UNLIMITED_MEMORY_THRESHOLD = 1 << 60

_NVML_LAST_SAMPLE_US: dict[int, int] = {}
_CPU_SAMPLE_LOCK = threading.Lock()
_CPU_SAMPLE_SOURCE = ""
_CPU_SAMPLE_USAGE_NS: int | None = None
_CPU_SAMPLE_TIME_NS: int | None = None
_CPU_SAMPLE_PERCENT = 0.0
_STATUS_CACHE_LOCK = threading.Lock()
_STATUS_CACHE_AT = 0.0
_STATUS_CACHE: dict[str, Any] | None = None


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return None


def _read_int(path: Path) -> int | None:
    value = _read_text(path)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _parse_proc_self_cgroup() -> dict[str, str]:
    """Map cgroup controllers to their process-relative cgroup paths."""
    text = _read_text(Path("/proc/self/cgroup"))
    if not text:
        return {}

    controllers: dict[str, str] = {}
    for line in text.splitlines():
        parts = line.split(":", 2)
        if len(parts) != 3:
            continue
        names, relative_path = parts[1], parts[2]
        relative_path = relative_path.strip() or "/"
        if not names:
            controllers["__v2__"] = relative_path
            continue
        for name in names.split(","):
            if name:
                controllers[name] = relative_path
    return controllers


def _path_candidates(roots: tuple[Path, ...], relative_path: str, filename: str):
    relative = relative_path.lstrip("/")
    seen: set[Path] = set()
    for root in roots:
        candidates = []
        if relative:
            candidates.append(root / relative / filename)
        candidates.append(root / filename)
        for candidate in candidates:
            if candidate not in seen:
                seen.add(candidate)
                yield candidate


def _find_cgroup_file(
    roots: tuple[Path, ...], relative_path: str, filename: str
) -> Path | None:
    for candidate in _path_candidates(roots, relative_path, filename):
        if candidate.is_file():
            return candidate
    return None


def _count_cpuset(value: str | None) -> int:
    if not value:
        return 0
    total = 0
    try:
        for section in value.split(","):
            section = section.strip()
            if not section:
                continue
            if "-" in section:
                start, end = section.split("-", 1)
                total += int(end) - int(start) + 1
            else:
                int(section)
                total += 1
    except (TypeError, ValueError):
        return 0
    return max(total, 0)


def _running_in_container(cgroups: dict[str, str]) -> bool:
    if Path("/.dockerenv").exists() or Path("/run/.containerenv").exists():
        return True

    markers = ("docker", "kubepods", "containerd", "podman", "lxc")
    paths = list(cgroups.values())
    init_cgroup = _read_text(Path("/proc/1/cgroup"))
    if init_cgroup:
        paths.append(init_cgroup)
    joined = "\n".join(paths).lower()
    return any(marker in joined for marker in markers)


def _process_affinity_count(psutil: Any) -> int:
    try:
        affinity = psutil.Process().cpu_affinity()
        if affinity:
            return len(affinity)
    except (AttributeError, OSError, psutil.Error):
        pass
    return int(psutil.cpu_count(logical=True) or 1)


def _effective_cpu_capacity(
    psutil: Any,
    quota: int | None,
    period: int | None,
    cpuset_value: str | None,
) -> tuple[float, bool]:
    """Return usable CPU capacity and whether cgroup limits are restrictive."""
    host_count = float(psutil.cpu_count(logical=True) or 1)
    affinity_count = float(_process_affinity_count(psutil))
    candidates = [host_count, affinity_count]
    restricted = affinity_count + 1e-9 < host_count

    if quota is not None and period and quota > 0 and period > 0:
        quota_capacity = quota / period
        if quota_capacity > 0:
            candidates.append(quota_capacity)
            restricted = restricted or quota_capacity + 1e-9 < host_count

    cpuset_count = _count_cpuset(cpuset_value)
    if cpuset_count > 0:
        candidates.append(float(cpuset_count))
        restricted = restricted or cpuset_count < host_count

    return max(min(candidates), 0.01), restricted


def _sample_cgroup_cpu(source: str, usage_ns: int, capacity: float) -> float:
    """Calculate non-blocking CPU utilization from consecutive cgroup samples."""
    global _CPU_SAMPLE_SOURCE
    global _CPU_SAMPLE_USAGE_NS
    global _CPU_SAMPLE_TIME_NS
    global _CPU_SAMPLE_PERCENT

    now_ns = time.monotonic_ns()
    with _CPU_SAMPLE_LOCK:
        if (
            _CPU_SAMPLE_SOURCE != source
            or _CPU_SAMPLE_USAGE_NS is None
            or _CPU_SAMPLE_TIME_NS is None
            or usage_ns < _CPU_SAMPLE_USAGE_NS
        ):
            _CPU_SAMPLE_SOURCE = source
            _CPU_SAMPLE_USAGE_NS = usage_ns
            _CPU_SAMPLE_TIME_NS = now_ns
            _CPU_SAMPLE_PERCENT = 0.0
            return 0.0

        elapsed_ns = now_ns - _CPU_SAMPLE_TIME_NS
        if elapsed_ns < int(MIN_CPU_SAMPLE_SECONDS * 1_000_000_000):
            return _CPU_SAMPLE_PERCENT

        used_ns = usage_ns - _CPU_SAMPLE_USAGE_NS
        percent = used_ns / elapsed_ns / max(capacity, 0.01) * 100.0
        _CPU_SAMPLE_USAGE_NS = usage_ns
        _CPU_SAMPLE_TIME_NS = now_ns
        _CPU_SAMPLE_PERCENT = max(0.0, min(100.0, float(percent)))
        return _CPU_SAMPLE_PERCENT


def _read_memory_stat(path: Path | None) -> dict[str, int]:
    if path is None:
        return {}
    text = _read_text(path)
    if not text:
        return {}
    values: dict[str, int] = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) != 2:
            continue
        try:
            values[parts[0]] = int(parts[1])
        except ValueError:
            continue
    return values


def _memory_result(
    usage_bytes: int,
    limit_bytes: int,
    inactive_file_bytes: int,
    source: str,
) -> dict[str, Any]:
    working_set = max(0, usage_bytes - max(0, inactive_file_bytes))
    percent = working_set / limit_bytes * 100.0 if limit_bytes > 0 else -1.0
    return {
        "ram_percent": max(0.0, min(100.0, float(percent))),
        "ram_used_mb": int(working_set // MIB),
        "ram_total_mb": int(limit_bytes // MIB),
        "ram_raw_used_mb": int(usage_bytes // MIB),
        "ram_inactive_file_mb": int(max(0, inactive_file_bytes) // MIB),
        "ram_source": source,
    }


def _cgroup_v2_metrics(psutil: Any, cgroups: dict[str, str]) -> dict[str, Any] | None:
    relative_path = cgroups.get("__v2__")
    if relative_path is None:
        return None

    roots = (Path("/sys/fs/cgroup"),)
    cpu_stat_path = _find_cgroup_file(roots, relative_path, "cpu.stat")
    cpu_max_path = _find_cgroup_file(roots, relative_path, "cpu.max")
    cpuset_path = _find_cgroup_file(roots, relative_path, "cpuset.cpus.effective")
    if cpuset_path is None:
        cpuset_path = _find_cgroup_file(roots, relative_path, "cpuset.cpus")

    quota = None
    period = None
    cpu_max = _read_text(cpu_max_path) if cpu_max_path else None
    if cpu_max:
        fields = cpu_max.split()
        if len(fields) >= 2:
            if fields[0] != "max":
                try:
                    quota = int(fields[0])
                except ValueError:
                    quota = None
            try:
                period = int(fields[1])
            except ValueError:
                period = None

    capacity, restricted = _effective_cpu_capacity(
        psutil, quota, period, _read_text(cpuset_path) if cpuset_path else None
    )
    containerized = _running_in_container(cgroups)

    result: dict[str, Any] = {}
    cpu_stat = _read_memory_stat(cpu_stat_path)
    usage_usec = cpu_stat.get("usage_usec")
    usage_nsec = cpu_stat.get("usage_nsec")
    if usage_usec is not None and (containerized or restricted):
        result["cpu_percent"] = _sample_cgroup_cpu(
            f"cgroup-v2:{cpu_stat_path}", usage_usec * 1_000, capacity
        )
        result["cpu_source"] = "cgroup-v2"
        result["cpu_capacity"] = capacity
    elif usage_nsec is not None and (containerized or restricted):
        result["cpu_percent"] = _sample_cgroup_cpu(
            f"cgroup-v2:{cpu_stat_path}", usage_nsec, capacity
        )
        result["cpu_source"] = "cgroup-v2"
        result["cpu_capacity"] = capacity

    memory_current_path = _find_cgroup_file(roots, relative_path, "memory.current")
    memory_max_path = _find_cgroup_file(roots, relative_path, "memory.max")
    memory_stat_path = _find_cgroup_file(roots, relative_path, "memory.stat")
    usage = _read_int(memory_current_path) if memory_current_path else None
    memory_max_text = _read_text(memory_max_path) if memory_max_path else None
    limit = None
    if memory_max_text and memory_max_text != "max":
        try:
            limit = int(memory_max_text)
        except ValueError:
            limit = None

    host_total = int(psutil.virtual_memory().total)
    finite_limit = limit is not None and 0 < limit < UNLIMITED_MEMORY_THRESHOLD
    meaningful_limit = finite_limit and (
        containerized or limit < int(host_total * 0.99)
    )
    if usage is not None and limit is not None and meaningful_limit:
        memory_stat = _read_memory_stat(memory_stat_path)
        inactive_file = memory_stat.get("inactive_file", 0)
        result.update(_memory_result(usage, limit, inactive_file, "cgroup-v2"))

    return result or None


def _cgroup_v1_metrics(psutil: Any, cgroups: dict[str, str]) -> dict[str, Any] | None:
    cpu_relative = cgroups.get("cpuacct") or cgroups.get("cpu")
    memory_relative = cgroups.get("memory")
    if cpu_relative is None and memory_relative is None:
        return None

    containerized = _running_in_container(cgroups)
    result: dict[str, Any] = {}

    if cpu_relative is not None:
        cpu_roots = (
            Path("/sys/fs/cgroup/cpu,cpuacct"),
            Path("/sys/fs/cgroup/cpuacct"),
            Path("/sys/fs/cgroup/cpu"),
        )
        usage_path = _find_cgroup_file(cpu_roots, cpu_relative, "cpuacct.usage")
        quota_path = _find_cgroup_file(cpu_roots, cpu_relative, "cpu.cfs_quota_us")
        period_path = _find_cgroup_file(cpu_roots, cpu_relative, "cpu.cfs_period_us")

        cpuset_relative = cgroups.get("cpuset", cpu_relative)
        cpuset_roots = (Path("/sys/fs/cgroup/cpuset"),)
        cpuset_path = _find_cgroup_file(cpuset_roots, cpuset_relative, "cpuset.cpus")

        quota = _read_int(quota_path) if quota_path else None
        period = _read_int(period_path) if period_path else None
        capacity, restricted = _effective_cpu_capacity(
            psutil, quota, period, _read_text(cpuset_path) if cpuset_path else None
        )
        usage_ns = _read_int(usage_path) if usage_path else None
        if usage_ns is not None and (containerized or restricted):
            result["cpu_percent"] = _sample_cgroup_cpu(
                f"cgroup-v1:{usage_path}", usage_ns, capacity
            )
            result["cpu_source"] = "cgroup-v1"
            result["cpu_capacity"] = capacity

    if memory_relative is not None:
        memory_roots = (Path("/sys/fs/cgroup/memory"),)
        usage_path = _find_cgroup_file(
            memory_roots, memory_relative, "memory.usage_in_bytes"
        )
        limit_path = _find_cgroup_file(
            memory_roots, memory_relative, "memory.limit_in_bytes"
        )
        stat_path = _find_cgroup_file(memory_roots, memory_relative, "memory.stat")
        usage = _read_int(usage_path) if usage_path else None
        limit = _read_int(limit_path) if limit_path else None
        host_total = int(psutil.virtual_memory().total)
        finite_limit = limit is not None and 0 < limit < UNLIMITED_MEMORY_THRESHOLD
        meaningful_limit = finite_limit and (
            containerized or limit < int(host_total * 0.99)
        )
        if usage is not None and limit is not None and meaningful_limit:
            memory_stat = _read_memory_stat(stat_path)
            inactive_file = memory_stat.get(
                "total_inactive_file", memory_stat.get("inactive_file", 0)
            )
            result.update(_memory_result(usage, limit, inactive_file, "cgroup-v1"))

    return result or None


def _psutil_cpu_ram(psutil: Any) -> dict[str, Any]:
    ram = psutil.virtual_memory()
    return {
        "cpu_percent": float(psutil.cpu_percent(interval=None)),
        "cpu_source": "psutil-system",
        "cpu_capacity": float(_process_affinity_count(psutil)),
        "ram_percent": float(ram.percent),
        "ram_used_mb": int(ram.used // MIB),
        "ram_total_mb": int(ram.total // MIB),
        "ram_raw_used_mb": int(ram.used // MIB),
        "ram_inactive_file_mb": 0,
        "ram_source": "psutil-system",
    }


def _disk_metrics(psutil: Any) -> dict[str, Any]:
    disk_path = os.path.abspath(os.sep)
    try:
        import folder_paths

        disk_path = os.path.abspath(folder_paths.base_path)
    except Exception:
        pass

    disk = psutil.disk_usage(disk_path)
    return {
        "disk_percent": float(disk.percent),
        "disk_used_mb": int(disk.used // MIB),
        "disk_total_mb": int(disk.total // MIB),
        "disk_path": disk_path,
    }


def _cpu_ram_disk() -> dict[str, Any]:
    try:
        import psutil

        status = _psutil_cpu_ram(psutil)
        if sys.platform.startswith("linux"):
            cgroups = _parse_proc_self_cgroup()
            cgroup_status = _cgroup_v2_metrics(psutil, cgroups)
            if cgroup_status is None:
                cgroup_status = _cgroup_v1_metrics(psutil, cgroups)
            if cgroup_status:
                status.update(cgroup_status)
        status.update(_disk_metrics(psutil))
        return status
    except Exception as exc:
        LOGGER.debug("CPU/RAM/disk telemetry unavailable: %s", exc)
        return {
            "cpu_percent": -1,
            "cpu_source": "unavailable",
            "cpu_capacity": -1,
            "ram_percent": -1,
            "ram_used_mb": -1,
            "ram_total_mb": -1,
            "ram_raw_used_mb": -1,
            "ram_inactive_file_mb": -1,
            "ram_source": "unavailable",
            "disk_percent": -1,
            "disk_used_mb": -1,
            "disk_total_mb": -1,
            "disk_path": "",
        }


def _nvml_sample_value(pynvml: Any, sample: Any, value_type: int) -> float:
    """Convert an NVML sample union to a Python number."""
    value = sample.sampleValue
    mapping = {
        pynvml.NVML_VALUE_TYPE_DOUBLE: "dVal",
        pynvml.NVML_VALUE_TYPE_UNSIGNED_INT: "uiVal",
        pynvml.NVML_VALUE_TYPE_UNSIGNED_LONG: "ulVal",
        pynvml.NVML_VALUE_TYPE_UNSIGNED_LONG_LONG: "ullVal",
        pynvml.NVML_VALUE_TYPE_SIGNED_LONG_LONG: "sllVal",
        pynvml.NVML_VALUE_TYPE_SIGNED_INT: "siVal",
        pynvml.NVML_VALUE_TYPE_UNSIGNED_SHORT: "usVal",
    }
    attribute = mapping.get(value_type)
    if attribute is None:
        raise ValueError(f"Unsupported NVML value type: {value_type}")
    return float(getattr(value, attribute))


def _nvml_gpu_percent(pynvml: Any, handle: Any, index: int) -> tuple[float, str]:
    """Read GPU utilization using recent NVML samples when supported."""
    instant = -1.0
    try:
        instant = float(pynvml.nvmlDeviceGetUtilizationRates(handle).gpu)
    except Exception as exc:
        LOGGER.debug("NVML instant utilization unavailable for GPU %s: %s", index, exc)

    try:
        now_us = time.time_ns() // 1_000
        last_seen_us = _NVML_LAST_SAMPLE_US.get(index, now_us - NVML_SAMPLE_WINDOW_US)
        value_type, samples = pynvml.nvmlDeviceGetSamples(
            handle,
            pynvml.NVML_GPU_UTILIZATION_SAMPLES,
            last_seen_us,
        )

        values = []
        newest_us = last_seen_us
        for sample in samples:
            newest_us = max(newest_us, int(sample.timeStamp))
            value = _nvml_sample_value(pynvml, sample, value_type)
            if 0 <= value <= 100:
                values.append(value)

        if newest_us > last_seen_us:
            _NVML_LAST_SAMPLE_US[index] = newest_us

        if values:
            average = sum(values) / len(values)
            return max(instant, average), "pynvml-samples"
    except Exception as exc:
        LOGGER.debug("NVML sampled utilization unavailable for GPU %s: %s", index, exc)

    return instant, "pynvml"


def _gpu_from_pynvml() -> list[dict[str, Any]]:
    try:
        import pynvml

        pynvml.nvmlInit()
        gpus = []
        for index in range(pynvml.nvmlDeviceGetCount()):
            handle = pynvml.nvmlDeviceGetHandleByIndex(index)
            name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(name, bytes):
                name = name.decode("utf-8", errors="replace")

            memory = pynvml.nvmlDeviceGetMemoryInfo(handle)
            gpu_percent, source = _nvml_gpu_percent(pynvml, handle, index)
            try:
                temperature = pynvml.nvmlDeviceGetTemperature(
                    handle, pynvml.NVML_TEMPERATURE_GPU
                )
            except Exception:
                temperature = -1

            gpus.append(
                {
                    "index": index,
                    "name": str(name),
                    "gpu_percent": gpu_percent,
                    "vram_percent": (
                        float(memory.used / memory.total * 100)
                        if memory.total
                        else -1
                    ),
                    "vram_used_mb": int(memory.used // MIB),
                    "vram_total_mb": int(memory.total // MIB),
                    "temperature_c": float(temperature),
                    "source": source,
                }
            )
        return gpus
    except Exception as exc:
        LOGGER.debug("pynvml telemetry unavailable: %s", exc)
        return []


def _gpu_from_torch() -> list[dict[str, Any]]:
    """Fallback that reports accelerator VRAM but not load or temperature."""
    try:
        import torch

        if not torch.cuda.is_available():
            return []

        gpus = []
        for index in range(torch.cuda.device_count()):
            free, total = torch.cuda.mem_get_info(index)
            used = total - free
            gpus.append(
                {
                    "index": index,
                    "name": torch.cuda.get_device_name(index),
                    "gpu_percent": -1,
                    "vram_percent": float(used / total * 100) if total else -1,
                    "vram_used_mb": int(used // MIB),
                    "vram_total_mb": int(total // MIB),
                    "temperature_c": -1,
                    "source": "torch",
                }
            )
        return gpus
    except Exception as exc:
        LOGGER.debug("PyTorch GPU telemetry unavailable: %s", exc)
        return []


def _collect_resource_status_uncached() -> dict[str, Any]:
    status = _cpu_ram_disk()
    gpus = _gpu_from_pynvml()
    if not gpus:
        gpus = _gpu_from_torch()
    status["gpus"] = gpus
    status["gpu_available"] = bool(gpus)
    return status


def collect_resource_status() -> dict[str, Any]:
    """Collect telemetry with a short cache for simultaneous browser tabs."""
    global _STATUS_CACHE_AT
    global _STATUS_CACHE

    now = time.monotonic()
    with _STATUS_CACHE_LOCK:
        if _STATUS_CACHE is not None and now - _STATUS_CACHE_AT < STATUS_CACHE_SECONDS:
            return dict(_STATUS_CACHE)

        status = _collect_resource_status_uncached()
        _STATUS_CACHE = dict(status)
        _STATUS_CACHE_AT = now
        return status


try:
    from aiohttp import web
    from server import PromptServer

    @PromptServer.instance.routes.get("/inteliweb/resource_monitor")
    async def inteliweb_resource_monitor(request):
        return web.json_response(collect_resource_status())
except Exception as exc:
    LOGGER.debug("Resource monitor route was not registered: %s", exc)
