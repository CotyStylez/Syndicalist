import { h, mount } from '../utils/dom.js';

export function renderIdentityView(content, app) {
  const { state } = app;
  let passphrase = '';
  let confirmPassphrase = '';
  let importValue = '';
  let revealNsec = false;

  const intro = h('section', { class: 'card' }, [
    h('h2', {}, 'Your identity'),
    h('p', { class: 'muted' }, [
      'Sydacalist identities are Nostr keypairs generated in your browser. ',
      'Your ',
      h('strong', {}, 'public key (npub)'),
      ' is safe to share — it is how people find and verify you. ',
      'Your ',
      h('strong', {}, 'private key (nsec)'),
      ' must stay secret: anyone with it can post as you and read your private notes. ',
      'It never leaves this device unless you explicitly export it.',
    ]),
  ]);

  let body;
  if (state.identity) {
    body = renderUnlocked();
  } else if (state.vaultExists) {
    body = renderLocked();
  } else {
    body = renderNoIdentity();
  }

  mount(content, intro, body);

  function renderNoIdentity() {
    const passInput = h('input', {
      type: 'password',
      placeholder: 'Choose a passphrase to encrypt your key locally',
      onInput: (e) => (passphrase = e.target.value),
    });
    const confirmInput = h('input', {
      type: 'password',
      placeholder: 'Confirm passphrase',
      onInput: (e) => (confirmPassphrase = e.target.value),
    });

    const generateBtn = h(
      'button',
      {
        class: 'primary',
        onClick: async () => {
          if (!passphrase || passphrase !== confirmPassphrase) {
            app.setError('Passphrases must match and cannot be empty.');
            return;
          }
          try {
            await app.generateNewIdentity(passphrase);
          } catch (err) {
            app.setError(err.message);
          }
        },
      },
      'Generate a new identity',
    );

    const importInput = h('textarea', {
      rows: 2,
      placeholder: 'Or paste an existing nsec1... or 64-char hex private key',
      onInput: (e) => (importValue = e.target.value),
    });

    const importBtn = h(
      'button',
      {
        onClick: async () => {
          if (!passphrase || passphrase !== confirmPassphrase) {
            app.setError('Passphrases must match and cannot be empty.');
            return;
          }
          try {
            await app.importAndSealIdentity(importValue, passphrase);
          } catch (err) {
            app.setError(err.message);
          }
        },
      },
      'Import this key instead',
    );

    return h('section', { class: 'card' }, [
      h('h3', {}, 'Create or import a key'),
      h('div', { class: 'field' }, [h('label', {}, 'Local unlock passphrase'), passInput, confirmInput]),
      generateBtn,
      h('hr'),
      h('div', { class: 'field' }, [h('label', {}, 'Import existing private key (optional)'), importInput]),
      importBtn,
      h('p', { class: 'muted small' }, 'The passphrase encrypts your key at rest in this browser. It is never sent anywhere and cannot be recovered if lost.'),
    ]);
  }

  function renderLocked() {
    const passInput = h('input', {
      type: 'password',
      placeholder: 'Enter your passphrase',
      onInput: (e) => (passphrase = e.target.value),
      onKeydown: (e) => {
        if (e.key === 'Enter') unlock();
      },
    });

    async function unlock() {
      try {
        await app.unlockIdentity(passphrase);
      } catch (err) {
        app.setError('Wrong passphrase, or no identity stored.');
      }
    }

    return h('section', { class: 'card' }, [
      h('h3', {}, 'Unlock your identity'),
      h('div', { class: 'field' }, [h('label', {}, 'Passphrase'), passInput]),
      h('button', { class: 'primary', onClick: unlock }, 'Unlock'),
      h('hr'),
      h(
        'button',
        {
          class: 'danger',
          onClick: async () => {
            if (confirm('This deletes your stored identity and private notes from this browser. Continue?')) {
              await app.forgetIdentityOnly();
            }
          },
        },
        'Forget stored identity',
      ),
    ]);
  }

  function renderUnlocked() {
    const { identity } = state;
    const nsecRow = h('div', { class: 'field' }, [
      h('label', {}, 'Private key (nsec) — keep secret'),
      h('div', { class: 'reveal-row' }, [
        h('code', { class: 'key-box' }, revealNsec ? identity.nsec : '•'.repeat(20)),
        h(
          'button',
          {
            class: 'link-btn',
            onClick: () => {
              revealNsec = !revealNsec;
              mount(content, intro, renderUnlocked());
            },
          },
          revealNsec ? 'Hide' : 'Reveal',
        ),
      ]),
    ]);

    return h('section', { class: 'card' }, [
      h('h3', {}, 'Unlocked ✅'),
      h('div', { class: 'field' }, [h('label', {}, 'Public key (npub) — safe to share'), h('code', { class: 'key-box' }, identity.npub)]),
      nsecRow,
      h('div', { class: 'button-row' }, [
        h('button', { onClick: () => app.lockIdentity() }, 'Lock'),
        h(
          'button',
          {
            class: 'danger',
            onClick: async () => {
              if (confirm('This permanently deletes your identity and private notes from this browser. Make sure you have backed up your nsec. Continue?')) {
                await app.forgetIdentityOnly();
              }
            },
          },
          'Delete identity from this browser',
        ),
      ]),
    ]);
  }
}
