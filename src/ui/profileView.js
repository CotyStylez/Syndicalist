import { h, mount } from '../utils/dom.js';
import { PROFILE_FONT_OPTIONS } from '../state.js';

const MAX_BACKGROUND_IMAGE_BYTES = 1_500_000; // ~1.5MB, kept generous but bounded since it's base64 in IndexedDB

/** Base CSS for the profile preview card, duplicated here (rather than
 * relying on the app's global stylesheet) because the preview is rendered
 * inside an isolated Shadow DOM root — see buildPreview() below for why. */
const PREVIEW_BASE_CSS = `
  :host { display: block; }
  .profile-preview {
    display: block;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    color: var(--text, #f2f2fb);
    background: var(--accent);
    background-size: cover;
    background-position: center;
    border-radius: 16px;
    overflow: hidden;
    border: 2px solid var(--theme);
    height: fit-content;
  }
  .preview-banner {
    background: linear-gradient(120deg, var(--theme), #000);
    font-size: 3rem;
    text-align: center;
    padding: 1.5rem 0;
  }
  .preview-header { display: flex; gap: 1rem; align-items: center; padding: 1rem; }
  .preview-avatar {
    font-size: 2.5rem;
    background: var(--theme);
    border-radius: 50%;
    width: 4rem;
    height: 4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .preview-widgets { padding: 0 1rem 1rem; display: grid; gap: 0.75rem; }
  .layout-grid .preview-widgets { grid-template-columns: 1fr 1fr; }
  .preview-widget { background: rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 0.75rem; }
  .preview-widget a { color: var(--theme, #ff2d75); }
  .preview-pay-links { padding: 0 1rem 1rem; display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .pay-link-btn {
    display: inline-block;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid #33335c;
    border-radius: 999px;
    padding: 0.35rem 0.85rem;
    font-size: 0.85rem;
    color: inherit;
    text-decoration: none;
  }
  .pay-link-btn:hover { border-color: var(--theme, #ff2d75); }
  .muted { color: var(--muted, #9a9ab3); }
`;

export function renderProfileView(content, app) {
  const { state } = app;
  const draft = {
    ...state.profile,
    widgets: state.profile.widgets.map((w) => ({ type: 'text', ...w })),
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
      field(
        'Font',
        h(
          'select',
          { onChange: (e) => { draft.fontFamily = e.target.value; draw(); } },
          PROFILE_FONT_OPTIONS.map((opt) =>
            h('option', { value: opt.id, selected: draft.fontFamily === opt.id ? '' : undefined }, opt.label),
          ),
        ),
      ),
      h('h4', {}, '🖼️ Full decoration — your page, your rules'),
      h('p', { class: 'muted small' }, [
        'Go as far as you want, MySpace-style — a background image and freeform CSS to fully re-skin your preview below. ',
        h('strong', {}, 'Both of these stay on your device only'),
        ' — they are never published to Nostr, so they can never bloat relays or affect anyone else\'s browser. ',
        'Everything else on this page (name, bio, colors, font, widgets) is only published if you click "Save & publish".',
      ]),
      field(
        'Background image (stored locally only)',
        h('div', {}, [
          h('input', {
            type: 'file',
            accept: 'image/*',
            onChange: async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
                app.setError(`Image is too large (${Math.round(file.size / 1024)}KB) — keep it under ${Math.round(MAX_BACKGROUND_IMAGE_BYTES / 1024)}KB so it doesn't bloat local storage.`);
                return;
              }
              draft.backgroundImage = await fileToDataUrl(file);
              draw();
            },
          }),
          draft.backgroundImage
            ? h('button', { class: 'link-btn', onClick: () => { draft.backgroundImage = ''; draw(); } }, 'Remove image')
            : null,
        ]),
      ),
      field(
        'Custom CSS (stored locally only — advanced)',
        h('textarea', {
          rows: 5,
          class: 'code-input',
          placeholder: '.profile-preview { ... }\n.preview-widget { ... }',
          value: draft.customCss,
          onInput: (e) => (draft.customCss = e.target.value),
        }),
      ),
      h('p', { class: 'muted small' }, [
        'Your CSS only ever applies to the preview card below (it renders in an isolated sandbox) — it can\'t restyle the rest of the app, and since it\'s never published, it can\'t affect anyone else\'s browser either.',
      ]),
      h('h4', {}, 'Widgets'),
      h(
        'div',
        { class: 'widget-editor' },
        draft.widgets.map((widget, index) =>
          h('div', { class: 'widget-edit-row' }, [
            h('input', { type: 'text', value: widget.title, placeholder: 'Widget title', onInput: (e) => (widget.title = e.target.value) }),
            h(
              'select',
              {
                onChange: (e) => {
                  widget.type = e.target.value;
                  draw();
                },
              },
              ['text', 'link'].map((opt) => h('option', { value: opt, selected: (widget.type || 'text') === opt ? '' : undefined }, opt)),
            ),
            widget.type === 'link'
              ? h('input', { type: 'text', value: widget.url || '', placeholder: 'https://…', onInput: (e) => (widget.url = e.target.value) })
              : null,
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
            draft.widgets.push({ title: 'New widget', content: '', type: 'text' });
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
                // customCss and backgroundImage are deliberately excluded —
                // they stay local-only (see the notice above the fields).
                const { customCss, backgroundImage, ...publishable } = draft;
                const metadata = { name: draft.displayName, about: draft.bio, sydacalist: publishable };
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
      h('p', { class: 'muted small' }, 'Publishing sends your display name, bio, styling, font, widgets, and Lightning address (if set) as public Nostr profile metadata (kind 0). Your background image and custom CSS never leave this device.'),
    ]);

    const preview = buildPreview(draft);

    mount(content, h('div', { class: 'profile-editor-grid' }, [form, preview]));
  }

  draw();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

/** Renders the live preview inside a Shadow DOM root so the user's freeform
 * `customCss` is fully sandboxed: it can only ever style elements inside
 * this shadow tree, never the editor form, the nav, or any other tab —
 * regardless of what selectors (even `*`, `html`, `body`) the user writes. */
function buildPreview(draft) {
  const host = h('div', { class: 'profile-preview-host' });
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = PREVIEW_BASE_CSS + '\n' + sanitizeCustomCss(draft.customCss);
  shadow.appendChild(style);

  const fontStack = PROFILE_FONT_OPTIONS.find((f) => f.id === draft.fontFamily)?.stack || 'inherit';

  const card = h(
    'section',
    {
      class: `profile-preview layout-${draft.layout}`,
      style: `--theme: ${draft.themeColor}; --accent: ${draft.accentColor}; font-family: ${fontStack}; background-image: ${draft.backgroundImage ? `url("${draft.backgroundImage}")` : 'none'};`,
    },
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
        draft.widgets.map((widget) =>
          h('div', { class: 'preview-widget' }, [
            h('strong', {}, widget.title),
            widget.type === 'link' && widget.url
              ? h('p', {}, [h('a', { href: widget.url, target: '_blank', rel: 'noopener noreferrer' }, widget.content || widget.url)])
              : h('p', {}, widget.content),
          ]),
        ),
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
  shadow.appendChild(card);
  return host;
}

/** Strips `</style>` sequences so pasted CSS can never prematurely close the
 * sandbox <style> tag it's injected into (defense in depth — textContent
 * assignment already prevents HTML parsing, but this keeps the stylesheet
 * itself from breaking if a user pastes in a stray closing tag). */
function sanitizeCustomCss(css) {
  if (typeof css !== 'string') return '';
  return css.replace(/<\/style/gi, '<\\/style');
}

