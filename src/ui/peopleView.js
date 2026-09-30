import { h, mount } from '../utils/dom.js';
import { shorten } from '../utils/format.js';
import { npubFor } from '../lib/relays.js';

// Looking someone up fetches their profile from relays (async). Only the
// lookup input value lives across redraws here; everything else reads
// straight from state.follows / state.profileCache.
let lookupValue = '';
let lookupError = null;
let lookupBusy = false;
let unsubscribeFeed = null;

export function renderPeopleView(content, app) {
  unsubscribeFeed?.();
  if (!app.state.relayHub) app.connectRelays();
  const redraw = () => draw(content, app);
  redraw();
  unsubscribeFeed = app.subscribeFeedUpdates(redraw);
}

function displayNameFor(state, pubkeyHex) {
  return state.profileCache[pubkeyHex]?.name || shorten(npubFor(pubkeyHex));
}

function draw(content, app) {
  const { state } = app;

  const lookupCard = h('section', { class: 'card' }, [
    h('h3', {}, 'Find someone'),
    h('p', { class: 'muted small' }, "Paste an npub1… or hex public key to look up their published profile and follow them."),
    h('div', { class: 'button-row' }, [
      h('input', {
        type: 'text',
        placeholder: 'npub1… or hex pubkey',
        value: lookupValue,
        onInput: (e) => (lookupValue = e.target.value),
      }),
      h(
        'button',
        {
          class: 'primary',
          disabled: lookupBusy,
          onClick: async () => {
            lookupError = null;
            lookupBusy = true;
            draw(content, app);
            try {
              await app.followPubkey(lookupValue);
              lookupValue = '';
            } catch (err) {
              lookupError = err.message;
            } finally {
              lookupBusy = false;
              draw(content, app);
            }
          },
        },
        lookupBusy ? 'Looking up…' : 'Follow',
      ),
    ]),
    lookupError ? h('p', { class: 'error-text' }, lookupError) : null,
  ]);

  const followsCard = h('section', { class: 'card' }, [
    h('h3', {}, `Following (${state.follows.length})`),
    state.follows.length === 0
      ? h('p', { class: 'muted' }, 'You are not following anyone yet. Look someone up above, or add them from the Feed tab.')
      : h(
          'ul',
          { class: 'follow-list' },
          state.follows.map((pubkeyHex) =>
            h('li', { class: 'follow-row' }, [
              h('span', { class: 'avatar' }, state.profileCache[pubkeyHex]?.picture ? '🖼️' : '👤'),
              h('span', { class: 'author', title: npubFor(pubkeyHex) }, displayNameFor(state, pubkeyHex)),
              h(
                'button',
                { class: 'link-btn', onClick: () => app.unfollowPubkey(pubkeyHex).then(() => draw(content, app)) },
                'Unfollow',
              ),
            ]),
          ),
        ),
    h('p', { class: 'muted small' }, 'Your follow list is stored locally and, once your identity is unlocked, published as a public Nostr contact list (kind 3) so it works in other Nostr clients too.'),
  ]);

  mount(content, lookupCard, followsCard);
}
