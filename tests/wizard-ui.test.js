const { describe, it, expect } = require('./harness');
const { renderProgressBar, renderSafetyFooter, STEP_LABELS, escapeHtml } = require('../core/admin/wizard-ui');

describe('Setup Wizard UI components', () => {
  it('renders progress bar with 7 steps and highlights active step', () => {
    const html = renderProgressBar(2, [0, 1], 'test-shop');
    
    // Check all labels exist (properly escaped)
    for (const label of STEP_LABELS) {
      expect(html.includes(escapeHtml(label))).toBeTrue();
    }

    // Check completed steps get the completed class and checkmark
    expect(html.includes('wizard-step completed')).toBeTrue();
    expect(html.includes('✅')).toBeTrue();

    // Check active step gets the active class
    expect(html.includes('wizard-step active')).toBeTrue();

    // Check clickability of completed/active steps
    expect(html.includes('/admin/wizard/test-shop/step/2')).toBeTrue(); // Current step is clickable
    expect(html.includes('/admin/wizard/test-shop/step/1')).toBeTrue(); // Completed step is clickable
    expect(html.includes('/admin/wizard/new')).toBeTrue(); // Step 0 is clickable
    
    // Check disabled/pending steps are marked disabled
    expect(html.includes('wizard-step-link disabled')).toBeTrue();
  });

  it('renders safety footer showing correct dry-run badge and env name', () => {
    const activeHtml = renderSafetyFooter(true, 'staging');
    const inactiveHtml = renderSafetyFooter(false, 'production');

    expect(activeHtml.includes('Global Dry-Run Active')).toBeTrue();
    expect(activeHtml.includes('safety-badge dry-run')).toBeTrue();
    expect(activeHtml.includes('staging mode')).toBeTrue();

    expect(inactiveHtml.includes('Dry-Run Inactive')).toBeTrue();
    expect(inactiveHtml.includes('safety-badge dry-run inactive')).toBeTrue();
    expect(inactiveHtml.includes('production mode')).toBeTrue();
  });
});
