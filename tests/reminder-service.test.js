const { describe, it, expect } = require('./harness');
const { createReminderService } = require('../core/reminder-service');

function createMockStorage() {
  const state = {
    orderDraft: {},
    candidates: [],
    handoff: new Set(),
    sent: [],
    failed: []
  };
  return {
    state,
    inHandoff(userId) {
      return state.handoff.has(userId);
    },
    getOrderDraft() {
      return { ...state.orderDraft };
    },
    listEngagedFollowUpCandidates() {
      return state.candidates.map(item => ({ ...item }));
    },
    markEngagedFollowUpReminderSent(userId, details) {
      state.sent.push({ userId, ...details });
    },
    markEngagedFollowUpReminderFailed(userId, details) {
      state.failed.push({ userId, ...details });
    }
  };
}

describe('reminder service: engaged follow-up worker', () => {
  it('keeps engaged follow-up disabled by default', async () => {
    const storage = createMockStorage();
    storage.state.candidates = [{
      userId: 'u_default_off',
      idleMs: 2 * 60 * 60 * 1000 + 1000,
      lastProductCode: 'MÃ8'
    }];
    let sendCount = 0;
    const service = createReminderService({
      storage,
      shopConfig: {},
      buildAbandonedCartReminderText: () => '',
      buildQuickReplies: () => [{ title: 'Xem mẫu hot', payload: 'HOT_PRODUCTS' }],
      sendQuickReplies: async () => {
        sendCount += 1;
      },
      deriveSessionState: () => 'PRODUCT_SELECTED',
      STATES: { CONFIRMED: 'CONFIRMED' },
      trackEvent: () => {}
    });

    const count = await service.scanEngagedFollowUpReminders({
      idleMs: 2 * 60 * 60 * 1000
    });
    expect(count).toBe(0);
    expect(sendCount).toBe(0);
    expect(storage.state.sent.length).toBe(0);
  });

  it('sends engaged follow-up once for eligible candidate', async () => {
    const storage = createMockStorage();
    storage.state.candidates = [{
      userId: 'u1',
      idleMs: 2 * 60 * 60 * 1000 + 1000,
      lastProductCode: 'MÃ8'
    }];
    const sentMessages = [];
    const events = [];
    const service = createReminderService({
      storage,
      shopConfig: {},
      buildAbandonedCartReminderText: () => '',
      buildQuickReplies: () => [{ title: 'Xem mẫu hot', payload: 'HOT_PRODUCTS' }],
      sendQuickReplies: async (id, text, quickReplies) => {
        sentMessages.push({ id, text, quickReplies });
      },
      deriveSessionState: () => 'PRODUCT_SELECTED',
      STATES: { CONFIRMED: 'CONFIRMED' },
      trackEvent: (senderId, type, text, meta) => events.push({ senderId, type, text, meta }),
      config: {
        engagedFollowUpEnabled: true,
        engagedFollowUpMs: 2 * 60 * 60 * 1000
      }
    });

    const count = await service.scanEngagedFollowUpReminders({
      idleMs: 2 * 60 * 60 * 1000
    });

    expect(count).toBe(1);
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0].id).toBe('u1');
    expect(sentMessages[0].text.includes('MÃ8')).toBeTrue();
    expect(storage.state.sent.length).toBe(1);
    expect(events.some(event => event.type === 'engaged_followup_reminder_sent')).toBeTrue();
  });

  it('does not send engaged follow-up when candidate no longer eligible', async () => {
    const storage = createMockStorage();
    storage.state.candidates = [{
      userId: 'u2',
      idleMs: 2 * 60 * 60 * 1000 + 1000,
      lastProductCode: 'MÃ10'
    }];
    let firstCall = true;
    storage.listEngagedFollowUpCandidates = () => {
      if (firstCall) {
        firstCall = false;
        return [{ userId: 'u2', idleMs: 2 * 60 * 60 * 1000 + 1000, lastProductCode: 'MÃ10' }];
      }
      return [];
    };
    let sendCount = 0;
    const service = createReminderService({
      storage,
      shopConfig: {},
      buildAbandonedCartReminderText: () => '',
      buildQuickReplies: () => [{ title: 'Xem mẫu hot', payload: 'HOT_PRODUCTS' }],
      sendQuickReplies: async () => {
        sendCount += 1;
      },
      deriveSessionState: () => 'PRODUCT_SELECTED',
      STATES: { CONFIRMED: 'CONFIRMED' },
      trackEvent: () => {},
      config: {
        engagedFollowUpEnabled: true,
        engagedFollowUpMs: 2 * 60 * 60 * 1000
      }
    });

    const count = await service.scanEngagedFollowUpReminders({
      idleMs: 2 * 60 * 60 * 1000
    });
    expect(count).toBe(0);
    expect(sendCount).toBe(0);
    expect(storage.state.sent.length).toBe(0);
  });

  it('does not send engaged follow-up for confirmed sessions', async () => {
    const storage = createMockStorage();
    storage.state.candidates = [{
      userId: 'u3',
      idleMs: 2 * 60 * 60 * 1000 + 1000,
      lastProductCode: 'MÃ2'
    }];
    let sendCount = 0;
    const service = createReminderService({
      storage,
      shopConfig: {},
      buildAbandonedCartReminderText: () => '',
      buildQuickReplies: () => [{ title: 'Xem mẫu hot', payload: 'HOT_PRODUCTS' }],
      sendQuickReplies: async () => {
        sendCount += 1;
      },
      deriveSessionState: () => 'CONFIRMED',
      STATES: { CONFIRMED: 'CONFIRMED' },
      trackEvent: () => {},
      config: {
        engagedFollowUpEnabled: true
      }
    });

    const count = await service.scanEngagedFollowUpReminders({
      idleMs: 2 * 60 * 60 * 1000
    });
    expect(count).toBe(0);
    expect(sendCount).toBe(0);
  });
});
