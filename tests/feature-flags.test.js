const { describe, it, expect } = require('./harness');
const {
  getFeatureFlag,
  getRuleToggle,
  normalizeFeatureFlags
} = require('../core/shops/feature-flags');

describe('feature flag facade', () => {
  it('uses safe rule-toggle defaults when ruleToggles are missing', () => {
    expect(normalizeFeatureFlags({ botMode: { name: 'menu_code_handoff' } })).toEqual({
      productCodeLookupEnabled: true,
      menuSendingEnabled: true,
      postProductHandoffEnabled: true,
      fallbackEnabled: true,
      leadCaptureEnabled: false
    });
  });

  it('honors false overrides from settings_json.ruleToggles', () => {
    const config = {
      settings_json: {
        ruleToggles: {
          productCodeLookupEnabled: false,
          menuSendingEnabled: false,
          postProductHandoffEnabled: false,
          fallbackEnabled: false
        }
      }
    };

    expect(getRuleToggle(config, 'productCodeLookupEnabled', true)).toBeFalse();
    expect(getRuleToggle(config, 'menuSendingEnabled', true)).toBeFalse();
    expect(getRuleToggle(config, 'postProductHandoffEnabled', true)).toBeFalse();
    expect(getRuleToggle(config, 'fallbackEnabled', true)).toBeFalse();
  });

  it('honors true overrides and lets ruleToggles override legacy botMode options', () => {
    const config = {
      botMode: {
        productCodeLookupEnabled: false,
        leadCaptureEnabled: false
      },
      ruleToggles: {
        productCodeLookupEnabled: true,
        leadCaptureEnabled: true
      }
    };

    expect(getFeatureFlag(config, 'productCodeLookupEnabled', true)).toBeTrue();
    expect(getFeatureFlag(config, 'leadCaptureEnabled', false)).toBeTrue();
  });

  it('uses the provided default for unknown flags', () => {
    const config = {
      ruleToggles: {
        unknownFlag: true
      },
      botMode: {
        unknownFlag: true
      }
    };

    expect(getFeatureFlag(config, 'unknownFlag', false)).toBeFalse();
    expect(getFeatureFlag(config, 'unknownFlag', true)).toBeTrue();
  });
});
