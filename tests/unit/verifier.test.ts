import { describe, expect, it } from 'vitest';
import { evaluateOutcome, isSuccess, type TcfSignal } from '../../src/shared/verifier';

const tcf = (partial: Partial<TcfSignal>): TcfSignal => ({
  eventStatus: 'useractioncomplete',
  gdprApplies: true,
  purposesTotal: 10,
  purposesConsented: 10,
  vendorsConsented: 400,
  ...partial,
});

describe('evaluateOutcome', () => {
  it('is UNSAFE when the page navigated away', () => {
    expect(evaluateOutcome({ popupVisible: false, navigatedAway: true, signals: null }).outcome).toBe('UNSAFE');
  });

  it('is FAILED while the popup is still visible', () => {
    const signals = { tcf: tcf({ purposesConsented: 0, storageConsented: false }), gcm: null };
    expect(evaluateOutcome({ popupVisible: true, navigatedAway: false, signals }).outcome).toBe('FAILED');
    expect(evaluateOutcome({ popupVisible: true, navigatedAway: false, signals: null }).outcome).toBe('FAILED');
  });

  it('trusts the site when it confirms full consent although the popup check says visible', () => {
    const result = evaluateOutcome({ popupVisible: true, navigatedAway: false, signals: { tcf: tcf({}), gcm: null } });
    expect(result.outcome).toBe('FULL');
    expect(result.reasons.join()).toContain('inconclusive');
  });

  it('is FAILED while the dialog is on screen, even if the site reports full consent', () => {
    const result = evaluateOutcome({
      popupVisible: false,
      popupOnScreen: true,
      navigatedAway: false,
      signals: { tcf: tcf({}), gcm: null },
    });
    expect(result.outcome).toBe('FAILED');
  });

  it('treats a stale CMP popup check as closed when its dialog element is not on screen', () => {
    const input = { popupVisible: true, popupOnScreen: false, navigatedAway: false, signals: null };
    expect(evaluateOutcome({ ...input, popupCheckable: true }).outcome).toBe('LIKELY_FULL');
    expect(evaluateOutcome({ ...input, popupCheckable: false }).outcome).toBe('FAILED');
  });

  it('ignores TCF data while the CMP UI is still shown', () => {
    const signals = { tcf: tcf({ eventStatus: 'cmpuishown' }), gcm: null };
    expect(evaluateOutcome({ popupVisible: false, navigatedAway: false, signals }).outcome).toBe('LIKELY_FULL');
  });

  it('is FULL when TCF reports every disclosed purpose consented', () => {
    const result = evaluateOutcome({ popupVisible: false, navigatedAway: false, signals: { tcf: tcf({}), gcm: null } });
    expect(result.outcome).toBe('FULL');
    expect(result.reasons.join()).toContain('10/10 purposes');
  });

  it('is FULL when the site does not request every purpose', () => {
    const signals = { tcf: tcf({ purposesConsented: 7, storageConsented: true }), gcm: null };
    expect(evaluateOutcome({ popupVisible: false, navigatedAway: false, signals }).outcome).toBe('FULL');
  });

  it('is PARTIAL without consent to device storage (purpose 1)', () => {
    const signals = { tcf: tcf({ purposesConsented: 3, storageConsented: false }), gcm: null };
    expect(evaluateOutcome({ popupVisible: false, navigatedAway: false, signals }).outcome).toBe('PARTIAL');
  });

  it('ignores TCF when GDPR does not apply', () => {
    const signals = { tcf: tcf({ gdprApplies: false, purposesConsented: 0 }), gcm: null };
    expect(evaluateOutcome({ popupVisible: false, navigatedAway: false, signals }).outcome).toBe('LIKELY_FULL');
  });

  it('uses Google Consent Mode updates when there is no TCF', () => {
    const granted = { ad_storage: 'granted', analytics_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' };
    const full = evaluateOutcome({
      popupVisible: false,
      navigatedAway: false,
      signals: { tcf: null, gcm: { updated: true, values: granted } },
    });
    expect(full.outcome).toBe('FULL');

    const partial = evaluateOutcome({
      popupVisible: false,
      navigatedAway: false,
      signals: { tcf: null, gcm: { updated: true, values: { ...granted, ad_storage: 'denied' } } },
    });
    expect(partial.outcome).toBe('PARTIAL');
  });

  it('does not trust Consent Mode defaults without an update', () => {
    const result = evaluateOutcome({
      popupVisible: false,
      navigatedAway: false,
      signals: { tcf: null, gcm: { updated: false, values: { ad_storage: 'denied' } } },
    });
    expect(result.outcome).toBe('LIKELY_FULL');
  });

  it('is LIKELY_FULL when the popup frame disappeared and nothing is machine-readable', () => {
    const result = evaluateOutcome({ popupVisible: null, navigatedAway: false, signals: { tcf: null, gcm: null } });
    expect(result.outcome).toBe('LIKELY_FULL');
    expect(result.reasons[0]).toContain('frame removed');
  });
});

describe('isSuccess', () => {
  it('accepts FULL and LIKELY_FULL only', () => {
    expect(['FULL', 'LIKELY_FULL', 'PARTIAL', 'FAILED', 'UNSAFE'].map((o) => isSuccess(o as never))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
