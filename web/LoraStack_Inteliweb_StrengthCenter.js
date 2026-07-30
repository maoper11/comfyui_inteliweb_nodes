const STYLE_ID = "inteliweb-lora-stack-strength-center-css";

if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.inteliweb-lora-row input[type="number"] {
  text-align: center !important;
}
`;
  document.head.appendChild(style);
}
