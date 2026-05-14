const RULE_TOGGLE_DEFAULTS = Object.freeze({
  productCodeLookupEnabled: true,
  menuSendingEnabled: true,
  postProductHandoffEnabled: true,
  fallbackEnabled: true,
  leadCaptureEnabled: false
});

const RULE_TOGGLE_KEYS = Object.freeze(Object.keys(RULE_TOGGLE_DEFAULTS));

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (value == null || value === '') return undefined;
  const text = String(value).trim().toLowerCase();
  if (/^(1|true|yes|on|enabled|active)$/.test(text)) return true;
  if (/^(0|false|no|off|disabled|inactive)$/.test(text)) return false;
  return undefined;
}

function normalizeBooleanToggle(value, fallback) {
  if (Array.isArray(value)) {
    let hasFalse = false;
    for (const item of value) {
      const parsed = parseBoolean(item);
      if (parsed === true) return true;
      if (parsed === false) hasFalse = true;
    }
    return hasFalse ? false : fallback;
  }

  const parsed = parseBoolean(value);
  return parsed == null ? fallback : parsed;
}

function normalizeRuleToggles(value = {}, defaults = RULE_TOGGLE_DEFAULTS) {
  const source = isPlainObject(value) ? value : {};
  return Object.fromEntries(
    RULE_TOGGLE_KEYS.map(key => [
      key,
      normalizeBooleanToggle(source[key], defaults[key])
    ])
  );
}

function mergeRuleToggleInput(existing = {}, body = {}) {
  const current = normalizeRuleToggles(existing);
  const next = { ...current };
  for (const key of RULE_TOGGLE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    next[key] = normalizeBooleanToggle(body[key], RULE_TOGGLE_DEFAULTS[key]);
  }
  return normalizeRuleToggles(next);
}

module.exports = {
  RULE_TOGGLE_DEFAULTS,
  RULE_TOGGLE_KEYS,
  mergeRuleToggleInput,
  normalizeBooleanToggle,
  normalizeRuleToggles
};
