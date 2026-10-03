import { describe, expect, it } from 'vitest';
import { frameInfo, listenForFrameTokens } from '../../src/content/frames';

describe('frame tokens', () => {
  it('maps a token posted by a child frame to its iframe size and visibility', async () => {
    document.body.innerHTML = '<iframe id="consent"></iframe><iframe id="ad"></iframe>';
    const consent = document.getElementById('consent') as HTMLIFrameElement;
    consent.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: innerWidth, bottom: innerHeight / 2, width: innerWidth, height: innerHeight / 2 }) as DOMRect;
    listenForFrameTokens();
    window.dispatchEvent(new MessageEvent('message', { data: { ilcFrameToken: 't1' }, source: consent.contentWindow }));
    expect(frameInfo('t1')).toEqual({ visible: true, area: 0.5 });
    expect(frameInfo('unknown')).toBeNull();
  });
});
