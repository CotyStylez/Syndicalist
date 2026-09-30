import { h, mount } from '../utils/dom.js';
import { relativeTime, shorten, escapeHtml } from '../utils/format.js';
import { npubFor } from '../lib/relays.js';

// Feed events and relay status changes can arrive continuously in the
// background. This view subscribes to a dedicated, high-frequency channel
// (see state.js `subscribeFeedUpdates`) so those updates only redraw the
// feed tab itself instead of forcing a full-app re-render whenever the user
// might be typing on another tab.
let unsubscribeFeed = null;

export function renderFeedView(content, app) {
  unsubscribeFeed?.();

  const draw = () => drawFeed(content, app);
  draw();
  unsubscribeFeed = app.subscribeFeedUpdates(draw);
}

function drawFeed(content, app) {
  const { state } = app;

  if (!state.relayHub) {
    app.connectRelays();
  }

  const statusRow = h(
    'div',
    { class: 'relay-status-row' },
    state.relays.map((url) => {
      const status = state.relayStatus[url] || 'connecting';
      return h('span', { class: `relay-pill relay-${status}`, title: url }, `${statusIcon(status)} ${url.replace('wss://', '')}`);
    }),
  );

  const feedModeRow = h('div', { class: 'button-row' }, [
    h('span', { class: 'muted small' }, 'Feed:'),
    h(
      'button',
      {
        class: `tab-btn${state.prefs.feedMode === 'global' ? ' active' : ''}`,
        onClick: () => app.setFeedMode('global'),
      },
      '🌐 Global',
    ),
    h(
      'button',
      {
        class: `tab-btn${state.prefs.feedMode === 'following' ? ' active' : ''}`,
        onClick: () => app.setFeedMode('following'),
      },
      `👥 Following (${state.follows.length})`,
    ),
  ]);

  const composer = h('section', { class: 'card' }, [
    h('h3', {}, 'Share something'),
    !state.identity ? h('p', { class: 'muted' }, 'Unlock your identity in the 🔑 Identity tab to post.') : null,
    h('textarea', {
      rows: 3,
      placeholder: "What's on your mind?",
      value: state.draft,
      disabled: !state.identity,
      onInput: (e) => app.saveDraft(e.target.value),
    }),
    h(
      'button',
      {
        class: 'primary',
        disabled: !state.identity || !state.draft.trim(),
        onClick: async () => {
          try {
            await state.relayHub.publishNote({ content: state.draft.trim(), secretKeyHex: state.identity.secretKeyHex });
            await app.saveDraft('');
          } catch (err) {
            app.setError('Failed to publish note: ' + err.message);
          }
        },
      },
      'Post to relays',
    ),
  ]);

  const visibleFeed = state.feed.filter((e) => e.kind === 1);
  const feedList = h(
    'section',
    { class: 'feed-list' },
    visibleFeed.length === 0
      ? [
          h(
            'p',
            { class: 'muted' },
            state.prefs.feedMode === 'following' && state.follows.length === 0
              ? 'Follow people in the 👥 People tab to build your feed, or switch to 🌐 Global.'
              : 'No posts yet. Connect to relays and wait for the feed to populate.',
          ),
        ]
      : visibleFeed.map((event) => renderFeedItem(event, app)),
  );

  mount(content, statusRow, feedModeRow, composer, feedList);
}

function statusIcon(status) {
  if (status === 'connected') return '🟢';
  if (status === 'connecting') return '🟡';
  return '🔴';
}

function renderFeedItem(event, app) {
  const { state } = app;
  let showComment = false;
  const container = h('article', { class: 'feed-item' });
  void app.ensureProfileCached(event.pubkey);

  function draw() {
    const npub = npubFor(event.pubkey);
    const displayName = state.profileCache[event.pubkey]?.name;
    const isFollowing = state.follows.includes(event.pubkey);
    const isSelf = state.identity?.publicKeyHex === event.pubkey;
    const commentBox = showComment
      ? h('div', { class: 'inline-comment' }, [
          h('textarea', { rows: 2, id: `comment-${event.id}`, placeholder: 'Write a reply…' }),
          h(
            'button',
            {
              onClick: async () => {
                const textarea = container.querySelector(`#comment-${event.id}`);
                const text = textarea.value.trim();
                if (!text || !state.identity) return;
                await state.relayHub.publishComment({ content: text, targetEvent: event, secretKeyHex: state.identity.secretKeyHex });
                showComment = false;
                draw();
              },
            },
            'Reply',
          ),
        ])
      : null;

    mount(
      container,
      h('div', { class: 'feed-item-header' }, [
        h('span', { class: 'avatar' }, '👤'),
        h(
          'button',
          {
            class: 'link-btn author',
            title: npub,
            onClick: () => app.goToPeopleTab?.(),
          },
          displayName ? displayName : shorten(npub),
        ),
        h('span', { class: 'timestamp' }, relativeTime(event.created_at)),
        !isSelf
          ? h(
              'button',
              {
                class: 'link-btn',
                disabled: !state.identity,
                onClick: async () => {
                  try {
                    if (isFollowing) await app.unfollowPubkey(event.pubkey);
                    else await app.followPubkey(event.pubkey);
                  } catch (err) {
                    app.setError(err.message);
                  }
                },
              },
              isFollowing ? '✓ Following' : '+ Follow',
            )
          : null,
      ]),
      h('div', { class: 'feed-item-body', html: escapeHtml(event.content).replaceAll('\n', '<br>') }),
      h('div', { class: 'feed-item-actions' }, [
        h(
          'button',
          {
            class: 'link-btn',
            disabled: !state.identity,
            onClick: async () => {
              await state.relayHub.publishReaction({ targetEvent: event, secretKeyHex: state.identity.secretKeyHex });
            },
          },
          '❤️ Like',
        ),
        h(
          'button',
          {
            class: 'link-btn',
            disabled: !state.identity,
            onClick: async () => {
              await state.relayHub.publishRepost({ targetEvent: event, secretKeyHex: state.identity.secretKeyHex });
            },
          },
          '🔁 Repost',
        ),
        h(
          'button',
          {
            class: 'link-btn',
            disabled: !state.identity,
            onClick: () => {
              showComment = !showComment;
              draw();
            },
          },
          '💬 Comment',
        ),
      ]),
      commentBox,
    );
  }

  draw();
  return container;
}
