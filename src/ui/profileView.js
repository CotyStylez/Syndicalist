import { h, mount } from '../utils/dom.js';

export function renderProfileView(content, app) {
  const { state } = app;
  const draft = {
    ...state.profile,
    widgets: state.profile.widgets.map((w) => ({ ...w })),
    payLinks: (state.profile.payLinks || []).map((l) => ({ ...l })),
  };

  function field(label, input) {
    return h('div', { class: 'field' }, [h('label', {}, label), input]);
  }

  function draw() {
    const form = h('section', { class: 'card' }, [
      h('h3', {}, 'Customize your page'),
      field(
        'Display name',
        h('input', { type: 'text', value: draft.displayName, onInput: (e) => (draft.displayName = e.target.value) }),
      ),
      field('Bio', h('textarea', { rows: 2, value: draft.bio, onInput: (e) => (draft.bio = e.target.value) })),
      field(
        'Avatar (emoji placeholder)',
        h('input', { type: 'text', value: draft.avatarEmoji, maxlength: 4, onInput: (e) => (draft.avatarEmoji = e.target.value) }),
      ),
      field(
        'Banner (emoji placeholder)',
        h('input', { type: 'text', value: draft.bannerEmoji, maxlength: 4, onInput: (e) => (draft.bannerEmoji = e.target.value) }),
      ),
      field('Theme color', h('input', { type: 'color', value: draft.themeColor, onInput: (e) => (draft.themeColor = e.target.value) })),
      field(
        'Accent / background color',
        h('input', { type: 'color', value: draft.accentColor, onInput: (e) => (draft.accentColor = e.target.value) }),
      ),
      field(
        'Layout',
        h(
          'select',
          { onChange: (e) => (draft.layout = e.target.value) },
          ['classic', 'grid', 'minimal'].map((opt) =>
            h('option', { value: opt, selected: draft.layout === opt ? '' : undefined }, opt),
          ),
        ),
      ),
      h('h4', {}, 'Widgets'),
      h(
        'div',
        { class: 'widget-editor' },
        draft.widgets.map((widget, index) =>
          h('div', { class: 'widget-edit-row' }, [
            h('input', { type: 'text', value: widget.title, placeholder: 'Widget title', onInput: (e) => (widget.title = e.target.value) }),
            h('textarea', { rows: 2, value: widget.content, placeholder: 'Widget content', onInput: (e) => (widget.content = e.target.value) }),
            h(
              'button',
              {
                class: 'link-btn',
                onClick: () => {
                  draft.widgets.splice(index, 1);
                  draw();
                },
              },
              'Remove widget',
            ),
          ]),
        ),
      ),
      h(
        'button',
        {
          onClick: () => {
            draft.widgets.push({ title: 'New widget', content: '' });
            draw();
          },
        },
        '+ Add widget',
      ),
      h('h4', {}, '⚡ Tips & support'),
      h('p', { class: 'muted small' }, [
        'Optional. Your Lightning address powers real, no-platform-cut tip stickers during Live P2P sessions (see README for how zaps work). ',
        'Pay links are just plain external buttons (Cash App, Venmo, PayPal.me, anything) — this app never touches that money or sees if it was paid.',
      ]),
      field(
        '⚡ Lightning address (lud16, e.g. you@getalby.com)',
        h('input', {
          type: 'text',
          value: draft.lightningAddress,
          placeholder: 'you@getalby.com',
          onInput: (e) => (draft.lightningAddress = e.target.value.trim()),
        }),
      ),
      h(
        'div',
        { class: 'widget-editor' },
        draft.payLinks.map((link, index) =>
          h('div', { class: 'widget-edit-row' }, [
            h('input', {
              type: 'text',
              value: link.label,
              placeholder: 'Label (e.g. Cash App)',
              onInput: (e) => (link.label = e.target.value),
            }),
            h('input', {
              type: 'text',
              value: link.url,
              placeholder: 'https://cash.app/$yourtag',
              onInput: (e) => (link.url = e.target.value),
            }),
            h(
              'button',
              {
                class: 'link-btn',
                onClick: () => {
                  draft.payLinks.splice(index, 1);
                  draw();
                },
              },
              'Remove link',
            ),
          ]),
        ),
      ),
      h(
        'button',
        {
          onClick: () => {
            draft.payLinks.push({ label: '', url: '' });
            draw();
          },
        },
        '+ Add pay link',
      ),
      h('div', { class: 'button-row' }, [
        h('button', { class: 'primary', onClick: async () => await app.saveProfile(draft) }, 'Save locally'),
        h(
          'button',
          {
            disabled: !state.identity,
            title: state.identity ? '' : 'Unlock your identity to publish',
            onClick: async () => {
              await app.saveProfile(draft);
              try {
                const metadata = { name: draft.displayName, about: draft.bio, sydacalist: draft };
                if (draft.lightningAddress) metadata.lud16 = draft.lightningAddress;
                await state.relayHub?.publishProfileMetadata({
                  metadata,
                  secretKeyHex: state.identity.secretKeyHex,
                });
              } catch (err) {
                app.setError('Failed to publish profile: ' + err.message);
              }
            },
          },
          'Save & publish to Nostr',
        ),
      ]),
      h('p', { class: 'muted small' }, 'Publishing sends your display name, bio, styling, and Lightning address (if set) as public Nostr profile metadata (kind 0). Everything else stays local until you publish.'),
    ]);

    const preview = h(
      'section',
      { class: `profile-preview layout-${draft.layout}`, style: `--theme: ${draft.themeColor}; --accent: ${draft.accentColor};` },
      [
        h('div', { class: 'preview-banner' }, draft.bannerEmoji),
        h('div', { class: 'preview-header' }, [
          h('div', { class: 'preview-avatar' }, draft.avatarEmoji),
          h('div', {}, [
            h('h3', {}, draft.displayName || 'Unnamed creator'),
            h('p', { class: 'muted' }, draft.bio || 'No bio yet.'),
          ]),
        ]),
        h(
          'div',
          { class: 'preview-widgets' },
          draft.widgets.map((widget) => h('div', { class: 'preview-widget' }, [h('strong', {}, widget.title), h('p', {}, widget.content)])),
        ),
        draft.payLinks.filter((l) => l.url).length
          ? h(
              'div',
              { class: 'preview-pay-links' },
              draft.payLinks
                .filter((l) => l.url)
                .map((l) => h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', class: 'pay-link-btn' }, `💸 ${l.label || l.url}`)),
            )
          : null,
      ],
    );

    mount(content, h('div', { class: 'profile-editor-grid' }, [form, preview]));
  }

  draw();
}
