
(() => {
    const icons = {
        alert: `
            <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0Z"/>
            <path d="M12 9v4"/>
            <path d="M12 17h.01"/>
        `,

        wrench: `
            <path d="M14.7 6.3a5 5 0 0 0-6.6 6.6L3 18a2.1 2.1 0 0 0 3 3l5.1-5.1a5 5 0 0 0 6.6-6.6L14 13l-3-3 3.7-3.7Z"/>
        `,

        users: `
            <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="10" cy="7" r="4"/>
            <path d="M20 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        `,

        chevR: `
            <path d="m9 18 6-6-6-6"/>
        `,

        home: `
            <path d="m3 10 9-7 9 7"/>
            <path d="M5 9v12h14V9"/>
            <path d="M9 21v-7h6v7"/>
        `,

        grid: `
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/>
        `,

        clipboard: `
            <rect x="5" y="4" width="14" height="17" rx="2"/>
            <path d="M9 4V2h6v2"/>
            <path d="M9 10h6M9 14h6"/>
        `,

        shield: `
            <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/>
        `,

        door: `
            <path d="M4 21h16"/>
            <path d="M6 21V4l12-2v19"/>
            <path d="M14 12h.01"/>
        `,

        bell: `
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/>
            <path d="M10 21h4"/>
        `,

        settings: `
            <circle cx="12" cy="12" r="3"/>
            <path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z"/>
        `
    };

    // Render icons
    function renderIcons() {
        document.querySelectorAll("i[data-i]").forEach(oldIcon => {
            const name = oldIcon.dataset.i;
            const paths = icons[name];

            if (!paths) {
                console.warn("Icon not found:", name);
                return;
            }

            const svg = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "svg"
            );

            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("class", `ic ${oldIcon.className || ""}`.trim());
            svg.setAttribute("aria-hidden", "true");
            svg.setAttribute("focusable", "false");
            svg.innerHTML = paths;

            oldIcon.replaceWith(svg);
        });
    }

    // Add automatic back button
    function addBackButton() {
        if (document.querySelector(".page-back")) return;

        const main = document.querySelector("main.view");

        if (!main) return;

        const button = document.createElement("button");

        button.type = "button";
        button.className = "page-back";

        button.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m15 18-6-6 6-6"/>
            </svg>
            <span>Back</span>
        `;

        button.addEventListener("click", () => {
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.href = "../index.html";
            }
        });

        main.prepend(button);
    }

    renderIcons();
    addBackButton();
})();
