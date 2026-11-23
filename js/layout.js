(() => {
    'use strict';

    const icons = {
        alert: `
      <path d="M12 4l9 16H3z"/>
      <path d="M12 10v4M12 17v.5"/>
    `,
        wrench: `
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3 17.7 6.3 21l6.3-6.3a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.7-.7-.7-2.7z"/>
    `,
        users: `
      <circle cx="9" cy="8" r="3.5"/>
      <path d="M2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5"/>
      <circle cx="17" cy="9" r="2.5"/>
      <path d="M17 14.5c2.5 0 4 1.5 4.5 4.5"/>
    `,
        chevR: `<path d="M9 5l7 7-7 7"/>`,
        chevL: `<path d="M15 5l-7 7 7 7"/>`,
        home: `
      <path d="M3 11l9-8 9 8"/>
      <path d="M5 10v10h14V10"/>
      <path d="M10 20v-6h4v6"/>
    `,
        grid: `
      <rect x="3" y="3" width="7" height="7" rx="1.5"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5"/>
      <rect x="14" y="14" width="7" height="7" rx="1.5"/>
    `,
        clipboard: `
      <rect x="6" y="4" width="12" height="17" rx="2"/>
      <path d="M9 4h6v3H9z"/>
      <path d="M9 12h6M9 16h4"/>
    `,
        shield: `
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>
    `,
        door: `
      <path d="M6 21V4h9l3 2v15M3 21h18"/>
      <circle cx="12" cy="13" r=".8"/>
    `,
        bell: `
      <path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/>
      <path d="M10 21h4"/>
    `,
        megaphone: `
      <path d="M3 11v3l12 5V6z"/>
      <path d="M15 9.5c2 .5 3 1.5 3 2.5s-1 2-3 2.5M6 14v5h3v-3"/>
    `,
        'log-out': `
      <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>
    `,
        logout: `
      <path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>
    `,
        x: `<path d="M6 6l12 12M18 6L6 18"/>`,
        camera: `
      <path d="M4 8h3l2-3h6l2 3h3v11H4z"/>
      <circle cx="12" cy="13" r="3.5"/>
    `,
        clock: `
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 7v5l3 2"/>
    `,
        copy: `
      <rect x="8" y="8" width="12" height="12" rx="2"/>
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>
    `,
        download: `
      <path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>
    `,
        check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
        plus: `<path d="M12 5v14M5 12h14"/>`,
        moon: `<path d="M20 14a8 8 0 1 1-10-10 6.5 6.5 0 0 0 10 10z"/>`,
        menu: `<path d="M4 7h16M4 12h16M4 17h16"/>`,
        info: `
      <circle cx="12" cy="12" r="9"/>
      <path d="M12 11v5M12 8v.5"/>
    `,
        search: `
      <circle cx="11" cy="11" r="6.5"/>
      <path d="M16 16l4.5 4.5"/>
    `,
        calendar: `
      <rect x="3" y="5" width="18" height="16" rx="2"/>
      <path d="M3 10h18M8 3v4M16 3v4"/>
    `,
        printer: `
      <path d="M7 9V4h10v5M7 17H5v-6h14v6h-2"/>
      <rect x="7" y="14" width="10" height="6"/>
    `,
        trash: `
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>
    `,
        settings: `
      <circle cx="12" cy="12" r="3"/>
      <path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z"/>
    `
    };

    function renderIcons() {
        document.querySelectorAll('i[data-i]').forEach(oldIcon => {
            const name = oldIcon.dataset.i;
            const paths = icons[name];

            if (!paths) {
                console.warn('Icon not found:', name);
                return;
            }

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('class', `ic ${oldIcon.className || ''}`.trim());
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('focusable', 'false');
            svg.innerHTML = paths;
            oldIcon.replaceWith(svg);
        });
    }

    function addBackButton() {
        const page = document.body.dataset.page || '';
        const isTopLanding = ['dashboard.html', 'home.html', 'gate.html'].includes(page);
        if (isTopLanding) return;
        if (document.querySelector('.page-back') || document.querySelector('.view .back')) return;

        const main = document.querySelector('main.view');
        if (!main) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'page-back';
        button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m15 18-6-6 6-6"/>
      </svg>
      <span>Back</span>
    `;

        button.addEventListener('click', () => {
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.href = '../index.html';
            }
        });

        main.prepend(button);
    }

    renderIcons();
    addBackButton();
})();
