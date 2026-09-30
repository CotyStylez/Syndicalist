import { h, mount } from '../utils/dom.js';

export function renderNotesView(content, app) {
  const { state } = app;

  const intro = h('section', { class: 'card' }, [
    h('h2', {}, 'Private notes'),
    h('p', { class: 'muted' }, [
      'Anything you write here is encrypted at rest with your unlock passphrase and stored only in this browser — it is never sent to a relay. ',
      'Use this for personal scratch notes. To message someone else, use the 💬 Messages tab instead — those are end-to-end encrypted (NIP-17) and actually sent over Nostr relays.',
    ]),
  ]);

  if (!state.identity) {
    mount(content, intro, h('section', { class: 'card' }, [h('p', {}, 'Unlock your identity in the 🔑 Identity tab to view or add private notes.')]));
    return;
  }

  let title = '';
  let body = '';

  const composer = h('section', { class: 'card' }, [
    h('h3', {}, 'New private note'),
    h('input', { type: 'text', placeholder: 'Title', onInput: (e) => (title = e.target.value) }),
    h('textarea', {
      rows: 3,
      placeholder: 'Private content (encrypted before it touches disk)',
      onInput: (e) => (body = e.target.value),
    }),
    h(
      'button',
      {
        class: 'primary',
        onClick: async () => {
          if (!body.trim()) return;
          await app.addPrivateNote({ title: title.trim() || 'Untitled', body: body.trim() });
        },
      },
      'Save encrypted note',
    ),
  ]);

  const list = h(
    'section',
    { class: 'notes-list' },
    state.privateNotes.length === 0
      ? [h('p', { class: 'muted' }, 'No private notes yet.')]
      : state.privateNotes.map((note) =>
          h('article', { class: 'note-card' }, [
            h('div', { class: 'note-header' }, [
              h('strong', {}, note.title),
              h('button', { class: 'link-btn', onClick: () => app.deletePrivateNote(note.id) }, 'Delete'),
            ]),
            h('p', {}, note.body),
            h('span', { class: 'muted small' }, new Date(note.createdAt).toLocaleString()),
          ]),
        ),
  );

  mount(content, intro, composer, list);
}
