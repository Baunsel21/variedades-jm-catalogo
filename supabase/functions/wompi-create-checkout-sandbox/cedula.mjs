export function parseCheckoutCedula(input) {
  if (input === null || input === undefined) return { value: "", error: "required" };
  if (typeof input !== "string") return { value: "", error: "invalid" };

  const value = input.trim();
  if (!value) return { value: "", error: "required" };
  if (value.length > 60 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    return { value: "", error: "invalid" };
  }
  return { value, error: null };
}
