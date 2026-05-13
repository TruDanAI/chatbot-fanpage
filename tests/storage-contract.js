const fs = require('fs');
const os = require('os');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { describe, it, expect } = require('./harness');

function makeTempDataDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function readCsv(file) {
  return parse(fs.readFileSync(file, 'utf8'), {
    columns: true,
    skip_empty_lines: true
  });
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function runStorageAdapterContract({ name, createAdapter }) {
  describe(`${name}: storage adapter contract`, () => {
    it('exposes data dir and initializes export files', async () => {
      const dataDir = makeTempDataDir('chatbot-storage-contract-paths');
      const storage = await createAdapter({ dataDir });

      expect(storage.getDataDir()).toBe(dataDir);
      expect(storage.getCustomersFile()).toBe(path.join(dataDir, 'customers.csv'));
      expect(storage.getEventsFile()).toBe(path.join(dataDir, 'events.jsonl'));
      expect(fs.existsSync(storage.getCustomersFile())).toBeTrue();
    });

    it('stores Gemini history and returns a copy of the history array', async () => {
      const storage = await createAdapter({ dataDir: makeTempDataDir('chatbot-storage-contract-history') });
      const userId = 'contract_history';
      const history = [
        { role: 'user', parts: [{ text: 'mã 8' }] },
        { role: 'model', parts: [{ text: 'Dạ mã 8 ạ' }] }
      ];

      storage.setHistory(userId, history);
      const stored = storage.getHistory(userId);
      stored.push({ role: 'user', parts: [{ text: 'mutated' }] });

      expect(storage.getHistory(userId)).toEqual(history);
      expect(storage.getHistory('missing_user')).toEqual([]);
    });

    it('stores and expires handoff windows', async () => {
      const storage = await createAdapter({ dataDir: makeTempDataDir('chatbot-storage-contract-handoff') });
      const userId = 'contract_handoff';

      storage.setHandoff(userId, Date.now() + 60 * 1000);
      expect(storage.inHandoff(userId)).toBeTrue();

      storage.setHandoff(userId, Date.now() - 1000);
      expect(storage.inHandoff(userId)).toBeFalse();
    });

    it('stores product context, last user activity, profile and session state', async () => {
      const storage = await createAdapter({ dataDir: makeTempDataDir('chatbot-storage-contract-context') });
      const userId = 'contract_context';

      storage.setLastProductCode(userId, 'MÃ8');
      storage.setLastUserAt(userId, '2026-05-08T00:00:00.000Z');
      storage.setSessionState(userId, 'CONFIRMED');
      const profile = storage.setUserProfile(userId, {
        first_name: 'Nguyễn',
        last_name: 'An',
        profile_pic: 'https://example.test/pic.jpg',
        updatedAt: '2026-05-08T01:00:00.000Z'
      });

      expect(storage.getLastProductCode(userId)).toBe('MÃ8');
      expect(storage.getLastUserAt(userId)).toBe('2026-05-08T00:00:00.000Z');
      expect(storage.getSessionState(userId)).toBe('CONFIRMED');
      expect(profile.name).toBe('Nguyễn An');
      expect(storage.getUserProfile(userId)).toEqual(profile);

      storage.setSessionState(userId, '');
      expect(storage.getSessionState(userId)).toBe('');
    });

    it('merges, normalizes and clears order draft data', async () => {
      const storage = await createAdapter({ dataDir: makeTempDataDir('chatbot-storage-contract-order') });
      const userId = 'contract_order';

      storage.mergeOrderDraft(userId, {
        productCode: ' MÃ8 ',
        phone: ' 0987654321 ',
        cartItems: [
          { code: ' MÃ8 ', name: ' MÃ8 ', qty: '2', variant: ' đỏ ', display: 'ignored' },
          { code: '', name: '', qty: 1 }
        ]
      });
      const draft = storage.mergeOrderDraft(userId, {
        name: ' An ',
        address: ' 12 Trần Phú '
      });

      expect(draft.productCode).toBe('MÃ8');
      expect(draft.phone).toBe('0987654321');
      expect(draft.name).toBe('An');
      expect(draft.address).toBe('12 Trần Phú');
      expect(draft.cartItems).toEqual([{ code: 'MÃ8', name: 'MÃ8', qty: 2, variant: 'đỏ' }]);
      expect(Boolean(draft.updatedAt)).toBeTrue();

      storage.setSessionState(userId, 'CONFIRMED');
      storage.clearOrderDraft(userId);
      expect(storage.getOrderDraft(userId)).toEqual({});
      expect(storage.getSessionState(userId)).toBe('');
    });

    it('stores staff notification markers inside the current order draft', async () => {
      const storage = await createAdapter({ dataDir: makeTempDataDir('chatbot-storage-contract-staff') });
      const userId = 'contract_staff';

      expect(storage.getOrderStaffNotification(userId)).toEqual({ hash: '', at: '' });
      storage.mergeOrderDraft(userId, { productCode: 'MÃ8' });
      storage.setOrderStaffNotification(userId, {
        hash: 'hash-1',
        at: '2026-05-08T02:00:00.000Z'
      });

      expect(storage.getOrderStaffNotification(userId)).toEqual({
        hash: 'hash-1',
        at: '2026-05-08T02:00:00.000Z'
      });
      expect(storage.getOrderDraft(userId).staffNotifiedHash).toBe('hash-1');
    });

    it('resets timed-out sessions and preserves abandoned order snapshot in the return value', async () => {
      const storage = await createAdapter({ dataDir: makeTempDataDir('chatbot-storage-contract-timeout') });
      const userId = 'contract_timeout';

      storage.setLastProductCode(userId, 'MÃ8');
      storage.mergeOrderDraft(userId, {
        productCode: 'MÃ8',
        cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }]
      });

      const abandoned = storage.resetSessionAfterTimeout(userId);

      expect(abandoned.productCode).toBe('MÃ8');
      expect(storage.getOrderDraft(userId)).toEqual({});
      expect(storage.getLastProductCode(userId)).toBe('');
      expect(storage.getSessionState(userId)).toBe('IDLE');
    });

    it('lists and marks abandoned cart reminder candidates', async () => {
      const storage = await createAdapter({ dataDir: makeTempDataDir('chatbot-storage-contract-abandoned') });
      const now = Date.parse('2026-05-08T00:00:00.000Z');
      const oldEnough = new Date(now - 21 * 60 * 1000).toISOString();
      const userId = 'contract_abandoned';

      storage.setLastProductCode(userId, 'MÃ8');
      storage.setLastUserAt(userId, oldEnough);
      storage.mergeOrderDraft(userId, {
        productCode: 'MÃ8',
        cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }],
        phone: '0987654321'
      });

      const candidate = storage.listAbandonedCartReminderCandidates({
        now,
        idleMs: 20 * 60 * 1000,
        maxAgeMs: 23 * 60 * 60 * 1000
      }).find(item => item.userId === userId);

      expect(Boolean(candidate)).toBeTrue();
      expect(candidate.missingFields).toEqual(['name', 'address']);
      expect(candidate.lastProductCode).toBe('MÃ8');
      expect(candidate.orderDraft.phone).toBe('0987654321');

      storage.markAbandonedCartReminderSent(userId, {
        at: '2026-05-08T00:01:00.000Z',
        idleMs: candidate.idleMs,
        missingFields: candidate.missingFields
      });
      expect(storage.getOrderDraft(userId).abandonedCartReminderSentAt).toBe('2026-05-08T00:01:00.000Z');
      expect(storage.listAbandonedCartReminderCandidates({ now, idleMs: 1, maxAgeMs: 23 * 60 * 60 * 1000 })).toEqual([]);
    });

    it('marks failed abandoned cart reminders to avoid retry loops', async () => {
      const storage = await createAdapter({ dataDir: makeTempDataDir('chatbot-storage-contract-abandoned-failed') });
      const now = Date.parse('2026-05-08T00:00:00.000Z');
      const userId = 'contract_abandoned_failed';

      storage.setLastUserAt(userId, new Date(now - 21 * 60 * 1000).toISOString());
      storage.mergeOrderDraft(userId, {
        productCode: 'MÃ8',
        cartItems: [{ code: 'MÃ8', name: 'MÃ8', qty: 1 }]
      });
      storage.markAbandonedCartReminderFailed(userId, {
        at: '2026-05-08T00:02:00.000Z',
        status: 400,
        error: 'recipient unavailable'.repeat(30)
      });

      const draft = storage.getOrderDraft(userId);
      expect(draft.abandonedCartReminderFailedAt).toBe('2026-05-08T00:02:00.000Z');
      expect(draft.abandonedCartReminderFailedStatus).toBe(400);
      expect(draft.abandonedCartReminderFailedError.length).toBe(300);
      expect(storage.listAbandonedCartReminderCandidates({ now, idleMs: 1, maxAgeMs: 23 * 60 * 60 * 1000 })).toEqual([]);
    });

    it('lists and marks engaged follow-up reminder candidates', async () => {
      const storage = await createAdapter({ dataDir: makeTempDataDir('chatbot-storage-contract-engaged-followup') });
      const now = Date.parse('2026-05-08T10:00:00.000Z');
      const userId = 'contract_engaged_followup';
      storage.setSessionState(userId, 'PRODUCT_SELECTED');
      storage.setEngagedFollowUp(userId, {
        at: new Date(now - (2 * 60 * 60 * 1000 + 5 * 60 * 1000)).toISOString(),
        note: 'mã 8'
      });

      const candidate = storage.listEngagedFollowUpCandidates({
        now,
        idleMs: 2 * 60 * 60 * 1000,
        maxAgeMs: 3 * 24 * 60 * 60 * 1000
      }).find(item => item.userId === userId);

      expect(Boolean(candidate)).toBeTrue();
      expect(candidate.note).toBe('mã 8');

      storage.markEngagedFollowUpReminderSent(userId, {
        at: '2026-05-08T10:01:00.000Z',
        idleMs: candidate.idleMs
      });
      expect(storage.listEngagedFollowUpCandidates({ now, idleMs: 1, maxAgeMs: 3 * 24 * 60 * 60 * 1000 })).toEqual([]);

      storage.setEngagedFollowUp(userId, {
        at: new Date(now - (2 * 60 * 60 * 1000 + 5 * 60 * 1000)).toISOString(),
        note: 'mã 10'
      });
      storage.markEngagedFollowUpReminderFailed(userId, {
        at: '2026-05-08T10:02:00.000Z',
        status: 400,
        error: 'recipient unavailable'.repeat(30)
      });
      const blocked = storage.listEngagedFollowUpCandidates({
        now,
        idleMs: 2 * 60 * 60 * 1000,
        maxAgeMs: 3 * 24 * 60 * 60 * 1000
      }).find(item => item.userId === userId);
      expect(Boolean(blocked)).toBeFalse();
    });

    it('deduplicates message ids', async () => {
      const storage = await createAdapter({ dataDir: makeTempDataDir('chatbot-storage-contract-mids') });

      expect(storage.seenMid('mid-1')).toBeFalse();
      storage.markMid('mid-1');
      expect(storage.seenMid('mid-1')).toBeTrue();
    });

    it('appends customers CSV and event JSONL records', async () => {
      const storage = await createAdapter({ dataDir: makeTempDataDir('chatbot-storage-contract-append') });

      await storage.appendCustomer({
        at: '2026-05-08T00:00:00.000Z',
        type: 'lead',
        senderId: 'sender-1',
        productCode: 'MÃ8',
        phone: '0987654321',
        name: 'Nguyễn An',
        address: '12 Trần Phú',
        text: 'có, dấu phẩy',
        history: [{ role: 'user', parts: [{ text: 'mã 8' }] }]
      });
      await storage.appendEvent({
        at: '2026-05-08T00:00:01.000Z',
        type: 'message_received',
        senderId: 'sender-1',
        sessionState: 'PRODUCT_SELECTED',
        productCode: 'MÃ8',
        text: 'mã 8',
        meta: { messageId: 'mid-1' }
      });

      const customerRows = readCsv(storage.getCustomersFile());
      expect(customerRows.length).toBe(1);
      expect(customerRows[0].senderId).toBe('sender-1');
      expect(customerRows[0].text).toBe('có, dấu phẩy');
      expect(customerRows[0].history).toContain('mã 8');

      const events = readJsonl(storage.getEventsFile());
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('message_received');
      expect(events[0].meta).toEqual({ messageId: 'mid-1' });
    });
  });
}

module.exports = {
  runStorageAdapterContract
};
