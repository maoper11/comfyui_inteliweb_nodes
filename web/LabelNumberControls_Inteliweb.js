const STYLE_ID = "inteliweb-label-number-controls-css";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.inteliweb-label-number-control {
  display: grid;
  grid-template-columns: 24px minmax(42px, 1fr) 24px;
  align-items: center;
  width: 78px;
  min-width: 78px;
  height: 34px;
  overflow: hidden;
  border: 1px solid #484848;
  border-radius: 6px;
  background: #1d1d1d;
}

.inteliweb-label-number-control input[type="number"] {
  width: 100% !important;
  min-width: 0 !important;
  height: 32px !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  outline: 0 !important;
  background: transparent !important;
  color: #f1f1f1 !important;
  text-align: center !important;
  font-variant-numeric: tabular-nums;
  appearance: textfield;
  -moz-appearance: textfield;
}

.inteliweb-label-number-control input[type="number"]::-webkit-inner-spin-button,
.inteliweb-label-number-control input[type="number"]::-webkit-outer-spin-button {
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
}

.inteliweb-label-number-step {
  display: grid;
  place-items: center;
  width: 24px;
  height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #aaa;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  line-height: 1;
}

.inteliweb-label-number-step:hover {
  background: #303030;
  color: #fff;
}

.inteliweb-label-number-step:focus-visible {
  outline: 1px solid #bbb;
  outline-offset: -2px;
}
`;
  document.head.appendChild(style);
}

function numericLimit(input, key, fallback) {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : fallback;
}

function formatValue(value, step) {
  const stepText = String(step);
  const decimalIndex = stepText.indexOf(".");
  const decimals = decimalIndex >= 0 ? stepText.length - decimalIndex - 1 : 0;
  return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
}

function adjustValue(input, direction) {
  const current = Number(input.value);
  const step = numericLimit(input, "step", 1) || 1;
  const min = numericLimit(input, "min", Number.NEGATIVE_INFINITY);
  const max = numericLimit(input, "max", Number.POSITIVE_INFINITY);
  const base = Number.isFinite(current) ? current : 0;
  const next = Math.max(min, Math.min(max, base + step * direction));

  input.value = formatValue(next, step);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function decorateNumberInput(input) {
  if (!(input instanceof HTMLInputElement)) return;
  if (input.type !== "number") return;
  if (input.closest(".inteliweb-label-number-control")) return;
  if (!input.closest(".inteliweb-label-range")) return;

  const wrapper = document.createElement("div");
  wrapper.className = "inteliweb-label-number-control";

  const decrease = document.createElement("button");
  decrease.type = "button";
  decrease.className = "inteliweb-label-number-step";
  decrease.textContent = "◀";
  decrease.title = "Decrease value";
  decrease.setAttribute("aria-label", "Decrease value");

  const increase = document.createElement("button");
  increase.type = "button";
  increase.className = "inteliweb-label-number-step";
  increase.textContent = "▶";
  increase.title = "Increase value";
  increase.setAttribute("aria-label", "Increase value");

  input.replaceWith(wrapper);
  wrapper.append(decrease, input, increase);

  decrease.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    adjustValue(input, -1);
  });

  increase.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    adjustValue(input, 1);
  });
}

function decorateLabelEditor(root = document) {
  for (const input of root.querySelectorAll?.('.inteliweb-label-range input[type="number"]') || []) {
    decorateNumberInput(input);
  }
}

injectStyles();
decorateLabelEditor();

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.('.inteliweb-label-range input[type="number"]')) decorateNumberInput(node);
      decorateLabelEditor(node);
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
