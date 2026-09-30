import { h, mount } from '../utils/dom.js';

export function renderProfileView(content, app) {
  const { state } = app;
  const draft = { ...state.profile, widgets: state.profile.widgets.map((w) => ({ ...w })) };

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
                await state.relayHub?.publishProfileMetadata({
                  metadata: { name: draft.displayName, about: draft.bio, sydacalist: draft },
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
      h('p', { class: 'muted small' }, 'Publishing sends your display name, bio, and styling as public Nostr profile metadata (kind 0). Everything else stays local until you publish.'),
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
      ],
    );

    mount(content, h('div', { class: 'profile-editor-grid' }, [form, preview]));
  }

  draw();
}
