const {
  RULE_TOGGLE_DEFAULTS,
  normalizeBooleanToggle
} = require('../rule-toggles');

const FEATURE_FLAG_DEFAULTS = Object.freeze({
  ...RULE_TOGGLE_DEFAULTS
});
const BOT_MODE_FEATURE_KEYS = Object.freeze([
  'aiFallbackEnabled',
  'orderFlowEnabled',
  'followUpEnabled',
  'recommendationEnabled'
]);
const FEATURE_FLAG_KEYS = Object.freeze([
  ...Object.keys(FEATURE_FLAG_DEFAULTS),
  ...BOT_MODE_FEATURE_KEYS
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ownValue(source, key) {
  if (!isPlainObject(source)) return { found: false };
  if (!Object.prototype.hasOwnProperty.call(source, key)) return { found: false };
  return { found: true, value: source[key] };
}

function getFlagSources(shopConfig = {}) {
  const settingsJson = isPlainObject(shopConfig.settings_json)
    ? shopConfig.settings_json
    : shopConfig.settingsJson;

  return [
    shopConfig.featureFlags,
    shopConfig.ruleToggles,
    isPlainObject(settingsJson) ? settingsJson.ruleToggles : null,
    shopConfig.botMode,
    isPlainObject(settingsJson) ? settingsJson.botMode : null
  ];
}

function defaultForFlag(flagKey, defaultValue) {
  if (arguments.length >= 2) return defaultValue;
  return FEATURE_FLAG_DEFAULTS[flagKey];
}

function getFeatureFlag(shopConfig = {}, flagKey = '', defaultValue) {
  const key = String(flagKey || '').trim();
  if (!key) return defaultValue;
  const fallback = arguments.length >= 3
    ? defaultValue
    : defaultForFlag(key);
  if (!FEATURE_FLAG_KEYS.includes(key)) return fallback;

  for (const source of getFlagSources(shopConfig)) {
    const found = ownValue(source, key);
    if (!found.found) continue;
    return normalizeBooleanToggle(found.value, fallback);
  }

  return fallback;
}

function getRuleToggle(shopConfig = {}, key = '', defaultValue) {
  return arguments.length >= 3
    ? getFeatureFlag(shopConfig, key, defaultValue)
    : getFeatureFlag(shopConfig, key);
}

function normalizeFeatureFlags(shopConfig = {}, defaults = FEATURE_FLAG_DEFAULTS) {
  const keys = Object.keys(isPlainObject(defaults) ? defaults : FEATURE_FLAG_DEFAULTS);
  return Object.fromEntries(keys.map(key => [
    key,
    getFeatureFlag(shopConfig, key, defaults[key])
  ]));
}

module.exports = {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAG_KEYS,
  getFeatureFlag,
  getRuleToggle,
  normalizeFeatureFlags
};
