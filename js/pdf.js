function downloadAsPDF() {
    if (!window.jspdf) {
        alert('The PDF library failed to load (check your internet connection) — please try again.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });

    const marginX = 54;
    const marginTop = 54;
    const marginBottom = 54;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const usableWidth = pageWidth - marginX * 2;
    let y = marginTop;

    function ensureSpace(h) {
        if (y + h > pageHeight - marginBottom) {
            doc.addPage();
            y = marginTop;
        }
    }

    function sanitizeText(str) {
        if (!str) return str;
        return str
            .replace(/\s*→\s*/g, ' ')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/\u2026/g, '...')
            .replace(/[^\x00-\xFF\u2022]/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function addLine(text, opts = {}) {
        const { size = 12, style = 'normal', indent = 0, spacingAfter = 6, color = [0, 0, 0], link = null } = opts;
        text = sanitizeText(text);
        if (!text) return;
        doc.setFont('times', style);
        doc.setFontSize(size);
        doc.setTextColor(color[0], color[1], color[2]);
        const lineHeight = size * 1.45;
        const maxWidth = usableWidth - indent;
        const lines = doc.splitTextToSize(text, maxWidth);
        lines.forEach(line => {
            ensureSpace(lineHeight);
            if (link) {
                doc.textWithLink(line, marginX + indent, y, { url: link });
            } else {
                doc.text(line, marginX + indent, y);
            }
            y += lineHeight;
        });
        y += spacingAfter;
    }

    function addBullet(text) {
        const bulletIndent = 14;
        text = sanitizeText(text);
        if (!text) return;
        doc.setFont('times', 'normal');
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        const lineHeight = 12 * 1.45;
        const maxWidth = usableWidth - bulletIndent;
        const lines = doc.splitTextToSize(text, maxWidth);
        lines.forEach((line, idx) => {
            ensureSpace(lineHeight);
            if (idx === 0) doc.text('•', marginX, y);
            doc.text(line, marginX + bulletIndent, y);
            y += lineHeight;
        });
    }

    function stripEmoji(str) {
        return str.replace(/\p{Extended_Pictographic}/gu, '').trim();
    }

    // --- Header (pulled live from the DOM) ---
    const nameText = (document.querySelector('h1')?.textContent || '').trim();
    const subtitleText = (document.querySelector('.subtitle')?.textContent || '').trim();

    doc.setFont('times', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(0, 0, 0);
    doc.text(nameText, marginX, y);
    y += 24;

    addLine(subtitleText, { size: 12, style: 'italic', spacingAfter: 8 });

    const contactSpans = document.querySelectorAll('.contact-info span');
    let cx = marginX;
    doc.setFont('times', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    contactSpans.forEach((span, idx) => {
        const linkEl = span.querySelector('a');
        const text = stripEmoji(span.textContent);
        if (idx > 0) {
            const sep = '   •   ';
            doc.text(sep, cx, y);
            cx += doc.getTextWidth(sep);
        }
        if (linkEl) {
            doc.textWithLink(text, cx, y, { url: linkEl.href });
        } else {
            doc.text(text, cx, y);
        }
        cx += doc.getTextWidth(text);
    });
    y += 18;
    y += 14;

    // --- Sections (pulled live from the DOM, so new content just works) ---
    function getItemElements(sectionEl) {
        const items = [];
        Array.from(sectionEl.children).forEach(child => {
            if (child.tagName === 'H3') return;
            if (child.classList.contains('project-cards-grid')) {
                Array.from(child.children).forEach(pc => items.push(pc));
            } else {
                items.push(child);
            }
        });
        return items;
    }

    function processItem(itemEl) {
        ensureSpace(30);
        Array.from(itemEl.children).forEach(child => {
            if (child.tagName === 'H4') {
                addLine(child.textContent.trim(), { size: 12, style: 'bold', spacingAfter: 1 });
            } else if (child.classList.contains('cv-meta')) {
                const linkEl = child.querySelector('a');
                addLine(child.textContent.trim(), { size: 11, style: 'italic', color: [70, 70, 70], spacingAfter: 3, link: linkEl ? linkEl.href : null });
            } else if (child.classList.contains('skill-tags')) {
                const tags = Array.from(child.querySelectorAll('.skill-tag')).map(t => t.textContent.trim());
                addLine(tags.join(', '), { size: 12, spacingAfter: 4 });
            } else if (child.tagName === 'UL') {
                Array.from(child.children).forEach(li => addBullet(li.textContent.trim()));
                y += 6;
            } else if (child.tagName === 'P') {
                addLine(child.textContent.trim(), { size: 12, spacingAfter: 4 });
            }
        });
        y += 12;
    }

    const sections = document.querySelectorAll('#cv > .cv-section');
    sections.forEach(sectionEl => {
        const titleText = (sectionEl.querySelector('h3')?.textContent || '').trim();
        ensureSpace(40);
        addLine(titleText.toUpperCase(), { size: 13, style: 'bold', spacingAfter: 10 });

        getItemElements(sectionEl).forEach(itemEl => processItem(itemEl));

        y += 10;
    });

    doc.save('Nicky_Martin_CV.pdf');
}
