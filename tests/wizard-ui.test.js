const { describe, it, expect } = require('./harness');
const { renderProgressBar, renderSafetyFooter, STEP_LABELS, escapeHtml, renderGuidanceCard, renderEmptyState, renderRequirementList } = require('../core/admin/wizard-ui');

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

  it('renderGuidanceCard renders title, description, and optional action button', () => {
    const cardWithAction = renderGuidanceCard(
      'Bạn cần làm gì?',
      'Liên hệ quản trị viên để kiểm tra cấu hình.',
      '/admin/dashboard',
      'Quay lại Dashboard'
    );

    expect(cardWithAction.includes('guidance-card')).toBeTrue();
    expect(cardWithAction.includes('Bạn cần làm gì?')).toBeTrue();
    expect(cardWithAction.includes('Liên hệ quản trị viên để kiểm tra cấu hình.')).toBeTrue();
    expect(cardWithAction.includes('/admin/dashboard')).toBeTrue();
    expect(cardWithAction.includes('Quay lại Dashboard')).toBeTrue();
    expect(cardWithAction.includes('guidance-card-icon')).toBeTrue();
    expect(cardWithAction.includes('💡')).toBeTrue();

    // Card without action button
    const cardNoAction = renderGuidanceCard('Hướng dẫn', 'Mô tả chi tiết');
    expect(cardNoAction.includes('Hướng dẫn')).toBeTrue();
    expect(cardNoAction.includes('Mô tả chi tiết')).toBeTrue();
    expect(cardNoAction.includes('btn btn-secondary')).toBeFalse();
  });

  it('renderEmptyState renders icon, title, and description', () => {
    const html = renderEmptyState('📦', 'Chưa có sản phẩm nào', 'Cửa hàng cần ít nhất 1 sản phẩm.');

    expect(html.includes('empty-state')).toBeTrue();
    expect(html.includes('empty-state-icon')).toBeTrue();
    expect(html.includes('📦')).toBeTrue();
    expect(html.includes('Chưa có sản phẩm nào')).toBeTrue();
    expect(html.includes('Cửa hàng cần ít nhất 1 sản phẩm.')).toBeTrue();
  });

  it('renderRequirementList renders met and unmet items with correct badges', () => {
    const html = renderRequirementList([
      { label: 'Ít nhất 1 sản phẩm', met: true, detail: '3 sản phẩm' },
      { label: 'Tin nhắn Menu đã điền', met: false, detail: 'Điền ở mục bên dưới' }
    ]);

    expect(html.includes('requirement-list')).toBeTrue();
    expect(html.includes('requirement-item')).toBeTrue();
    // Met item
    expect(html.includes('Ít nhất 1 sản phẩm')).toBeTrue();
    expect(html.includes('✅')).toBeTrue();
    expect(html.includes('badge-success')).toBeTrue();
    expect(html.includes('Đạt')).toBeTrue();
    expect(html.includes('3 sản phẩm')).toBeTrue();
    // Unmet item
    expect(html.includes('Tin nhắn Menu đã điền')).toBeTrue();
    expect(html.includes('⬜')).toBeTrue();
    expect(html.includes('badge-danger')).toBeTrue();
    expect(html.includes('Chưa đạt')).toBeTrue();
    expect(html.includes('Điền ở mục bên dưới')).toBeTrue();
  });

  it('renderRequirementList returns empty string for empty or invalid input', () => {
    expect(renderRequirementList([])).toBe('');
    expect(renderRequirementList(null)).toBe('');
    expect(renderRequirementList(undefined)).toBe('');
  });

  it('renderGuidanceCard escapes HTML in title and description', () => {
    const html = renderGuidanceCard('<script>alert(1)</script>', 'Test & "quotes"');
    expect(html.includes('<script>')).toBeFalse();
    expect(html.includes('&lt;script&gt;')).toBeTrue();
    expect(html.includes('&amp;')).toBeTrue();
    expect(html.includes('&quot;')).toBeTrue();
  });
});
