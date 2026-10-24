// Builds the CV PDF from the live page text, then tags it for accessibility (PDF/UA)
// with js/pdfua.js. Only text is read from the page, never styles, so themes and the
// Accessibility panel can't change the export.

// Embedded fonts: Liberation Serif (SIL OFL), subset to Latin-1 + bullet.
// Metric-compatible with Times, so the layout matches the old built-in Times output.
// PDF/UA requires every font to be embedded; jsPDF's built-in Times is not.
const PDF_FONTS = [
    ['fonts/pdf/LiberationSerif-Regular.subset.ttf', 'normal'],
    ['fonts/pdf/LiberationSerif-Bold.subset.ttf', 'bold'],
    ['fonts/pdf/LiberationSerif-Italic.subset.ttf', 'italic']
];
const PDF_FONT_FAMILY = 'LiberationSerif';

async function loadPdfFonts(doc) {
    for (const [file, style] of PDF_FONTS) {
        const res = await fetch(file);
        if (!res.ok) throw new Error('Font ' + file + ' returned ' + res.status);
        const bytes = new Uint8Array(await res.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        const name = file.split('/').pop();
        doc.addFileToVFS(name, binary);
        doc.addFont(name, PDF_FONT_FAMILY, style);
    }
}

async function downloadAsPDF() {
    if (!window.jspdf) {
        alert('The PDF library failed to load (check your internet connection) — please try again.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter', putOnlyUsedFonts: true });

    let fontFamily = PDF_FONT_FAMILY;
    try {
        await loadPdfFonts(doc);
    } catch (err) {
        // Still produces a CV, just without embedded fonts (so not fully PDF/UA).
        console.warn('PDF fonts failed to load, falling back to built-in Times:', err);
        fontFamily = 'times';
    }

    const nameText = (document.querySelector('h1')?.textContent || '').trim();
    const ua = PdfUA.create(doc, {
        title: nameText ? nameText + ' - Curriculum Vitae' : 'Curriculum Vitae',
        lang: document.documentElement.lang || 'en-US'
    });

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
            .replace(/[‘’]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/[–—]/g, '-')
            .replace(/…/g, '...')
            .replace(/[^\x00-\xFF•]/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    // role = PDF structure type for this block of text (P, H1, H2, H3, ...)
    function addLine(text, opts = {}) {
        const { size = 12, style = 'normal', indent = 0, spacingAfter = 6, color = [0, 0, 0], link = null, role = 'P' } = opts;
        text = sanitizeText(text);
        if (!text) return;
        doc.setFont(fontFamily, style);
        doc.setFontSize(size);
        doc.setTextColor(color[0], color[1], color[2]);
        const lineHeight = size * 1.45;
        const maxWidth = usableWidth - indent;
        const lines = doc.splitTextToSize(text, maxWidth);
        ua.open(role);
        lines.forEach(line => {
            ensureSpace(lineHeight);
            if (link) {
                ua.link(link, line, marginX + indent, y, size, text);
            } else {
                ua.text(role, () => doc.text(line, marginX + indent, y));
            }
            y += lineHeight;
        });
        ua.close();
        y += spacingAfter;
    }

    // One list item: LI > Lbl (the bullet) + LBody (the text)
    function addBullet(text) {
        const bulletIndent = 14;
        text = sanitizeText(text);
        if (!text) return;
        doc.setFont(fontFamily, 'normal');
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        const lineHeight = 12 * 1.45;
        const maxWidth = usableWidth - bulletIndent;
        const lines = doc.splitTextToSize(text, maxWidth);
        ua.open('LI');
        lines.forEach((line, idx) => {
            ensureSpace(lineHeight);
            if (idx === 0) {
                ua.open('Lbl');
                ua.text('Lbl', () => doc.text('•', marginX, y));
                ua.close();
                ua.open('LBody');
            }
            ua.text('Span', () => doc.text(line, marginX + bulletIndent, y));
            y += lineHeight;
        });
        ua.close(); // LBody
        ua.close(); // LI
    }

    function stripEmoji(str) {
        return str.replace(/\p{Extended_Pictographic}/gu, '').trim();
    }

    // --- Header (pulled live from the DOM) ---
    const subtitleText = (document.querySelector('.subtitle')?.textContent || '').trim();

    doc.setFont(fontFamily, 'bold');
    doc.setFontSize(20);
    doc.setTextColor(0, 0, 0);
    ua.open('H1');
    ua.text('H1', () => doc.text(nameText, marginX, y));
    ua.close();
    y += 24;

    addLine(subtitleText, { size: 12, style: 'italic', spacingAfter: 8 });

    const contactSpans = document.querySelectorAll('.contact-info span');
    let cx = marginX;
    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    ua.open('P');
    contactSpans.forEach((span, idx) => {
        const linkEl = span.querySelector('a');
        const text = stripEmoji(span.textContent);
        if (idx > 0) {
            const sep = '   •   ';
            ua.text('Span', () => doc.text(sep, cx, y));
            cx += doc.getTextWidth(sep);
        }
        if (linkEl) {
            ua.link(linkEl.href, text, cx, y, 11, text);
        } else {
            ua.text('Span', () => doc.text(text, cx, y));
        }
        cx += doc.getTextWidth(text);
    });
    ua.close();
    y += 18;
    y += 14;

    // --- Sections (pulled live from the DOM, so new content just works) ---
    function getItemElements(sectionEl) {
        const items = [];
        Array.from(sectionEl.children).forEach(child => {
            if (child.tagName === 'H2') return;
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
        ua.open('Div');
        Array.from(itemEl.children).forEach(child => {
            if (child.tagName === 'H3') {
                addLine(child.textContent.trim(), { size: 12, style: 'bold', spacingAfter: 1, role: 'H3' });
            } else if (child.classList.contains('cv-meta')) {
                const linkEl = child.querySelector('a');
                addLine(child.textContent.trim(), { size: 11, style: 'italic', color: [70, 70, 70], spacingAfter: 3, link: linkEl ? linkEl.href : null });
            } else if (child.classList.contains('skill-tags')) {
                const tags = Array.from(child.querySelectorAll('.skill-tag')).map(t => t.textContent.trim());
                addLine(tags.join(', '), { size: 12, spacingAfter: 4 });
            } else if (child.tagName === 'UL') {
                ua.open('L');
                Array.from(child.children).forEach(li => addBullet(li.textContent.trim()));
                ua.close();
                y += 6;
            } else if (child.tagName === 'P') {
                addLine(child.textContent.trim(), { size: 12, spacingAfter: 4 });
            }
        });
        ua.close();
        y += 12;
    }

    const sections = document.querySelectorAll('#cv > .cv-section');
    sections.forEach(sectionEl => {
        const titleText = (sectionEl.querySelector('h2')?.textContent || '').trim();
        ensureSpace(40);
        ua.open('Sect');
        addLine(titleText.toUpperCase(), { size: 13, style: 'bold', spacingAfter: 10, role: 'H2' });

        getItemElements(sectionEl).forEach(itemEl => processItem(itemEl));
        ua.close();

        y += 10;
    });

    ua.finish();
    doc.save('Nicky_Martin_CV.pdf');
}