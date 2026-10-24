/*
 * pdfua.js - makes the jsPDF export a tagged PDF aimed at PDF/UA-1 (ISO 14289-1).
 *
 * jsPDF only draws marks on a page. A tagged PDF needs three more things, and this
 * file adds them without changing how anything looks:
 *
 *   1. MARKED CONTENT. Each piece of text is wrapped in "/Tag <</MCID n>> BDC ... EMC"
 *      in the page's content stream, so a screen reader can tell which marks are which.
 *   2. A STRUCTURE TREE. Document > Sect > H2 / Div > H3 / P / L > LI > Lbl + LBody ...
 *      Each node lists the marked content (MCID) and annotations that belong to it.
 *      A ParentTree maps the other way (page + MCID -> node) so readers can navigate
 *      from either side.
 *   3. DOCUMENT PLUMBING. /StructTreeRoot, /MarkInfo, /Lang, /ViewerPreferences with
 *      DisplayDocTitle, an XMP metadata packet that declares pdfuaid:part=1 and the
 *      title, /Tabs /S on every page, and /StructParent + /Contents on link annotations.
 *
 * Usage (see pdf.js):
 *   const ua = PdfUA.create(doc, { title: '...', lang: 'en-US' });
 *   ua.open('H1'); ua.text('H1', () => doc.text(...)); ua.close();
 *   ua.finish();           // right before doc.save()
 *
 * It only reads the DOM text pdf.js already hands it. Themes and accessibility
 * settings never reach it, so the export is identical on every theme.
 */
(function (global) {
    'use strict';

    // PDF string literal, escaped. ASCII-safe: anything above 0x7E is written as an
    // octal escape for the Latin-1 byte, so the object stays plain bytes.
    function pdfString(s) {
        var out = '';
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            if (c === 0x28 || c === 0x29 || c === 0x5C) out += '\\' + s.charAt(i);
            else if (c < 0x20 || c > 0x7E) out += '\\' + ('000' + (c & 0xFF).toString(8)).slice(-3);
            else out += s.charAt(i);
        }
        return '(' + out + ')';
    }

    // XML text with every non-ASCII character as a numeric reference (keeps the XMP ASCII).
    function xmlEscape(s) {
        return s.replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        }).replace(/[^\x20-\x7E]/g, function (c) {
            return '&#x' + c.charCodeAt(0).toString(16).toUpperCase() + ';';
        });
    }

    function create(doc, options) {
        options = options || {};
        var title = options.title || 'Document';
        var lang = options.lang || 'en-US';
        var internal = doc.internal;

        // Structure nodes: { type, parent, kids: [node | {mcid,page} | {annot,page}], alt }
        var root = { type: 'Document', parent: null, kids: [] };
        var current = root;
        var mcidCounter = {};        // page number -> next MCID on that page
        var pageMarks = {};          // page number -> [node owning MCID i]
        var annotations = [];        // { page, obj, node }
        var finished = false;

        // Tagged PDF + PDF/UA need PDF 1.7 (jsPDF defaults to the 1.3 header).
        if (doc.__private__ && doc.__private__.setPdfVersion) doc.__private__.setPdfVersion('1.7');
        doc.setDocumentProperties({ title: title });
        doc.setLanguage(lang);

        // ---- building the tree -------------------------------------------------

        function open(type, alt) {
            var node = { type: type, parent: current, kids: [], alt: alt || null };
            current.kids.push(node);
            current = node;
            return node;
        }

        function close() {
            if (current.parent) current = current.parent;
        }

        function pageNo() {
            return internal.getCurrentPageInfo().pageNumber;
        }

        // Wrap one drawing call in marked content owned by the current node.
        // `tag` is the marked-content tag, usually the same as the node type.
        function text(tag, draw) {
            var page = pageNo();
            var mcid = mcidCounter[page] || 0;
            mcidCounter[page] = mcid + 1;
            (pageMarks[page] = pageMarks[page] || [])[mcid] = current;
            current.kids.push({ page: page, mcid: mcid });
            internal.write('/' + tag + ' <</MCID ' + mcid + '>> BDC');
            draw();
            internal.write('EMC');
        }

        // A clickable piece of text: Link node > marked content + the annotation.
        // (x, y) is the text baseline in jsPDF user units (pt, origin top-left).
        function link(url, str, x, y, size, alt) {
            var node = open('Link', alt || str);
            text('Link', function () { doc.text(str, x, y); });
            var w = doc.getTextWidth(str);
            var pageH = internal.pageSize.getHeight();
            var page = pageNo();
            annotations.push({
                page: page,
                obj: null, // allocated while the PDF is being written (object ids only exist then)
                node: node,
                url: url,
                contents: alt || str,
                rect: [x, pageH - (y + size * 0.25), x + w, pageH - (y - size * 0.8)]
            });
            node.kids.push({ page: page, annotIndex: annotations.length - 1 });
            close();
        }

        // ---- writing the PDF objects -------------------------------------------

        // Every page gets /Tabs /S (tab order = structure order) and /StructParents.
        // jsPDF numbers its PDF objects while it writes the file (not while you draw),
        // so everything that needs an object id is created inside these write-time hooks.
        internal.events.subscribe('putPage', function (data) {
            if (!finished) return;
            internal.write('/Tabs /S /StructParents ' + (data.pageNumber - 1));
            var pageCount = internal.getNumberOfPages();
            var ids = [];
            annotations.forEach(function (a, i) {
                if (a.page !== data.pageNumber) return;
                a.obj = internal.newAdditionalObject();
                a.obj.content =
                    '<</Type /Annot /Subtype /Link /Rect [' + a.rect.map(function (v) { return v.toFixed(2); }).join(' ') + ']' +
                    ' /Border [0 0 0] /F 4 /P ' + ref(data.objId) +
                    ' /Contents ' + pdfString(a.contents) +
                    ' /A <</S /URI /URI ' + pdfString(a.url) + '>>' +
                    ' /StructParent ' + (pageCount + i) + '>>';
                ids.push(ref(a.obj.objId));
            });
            if (ids.length) internal.write('/Annots [' + ids.join(' ') + ']');
        });

        var treeRootId = null;
        var metadataId = null;

        internal.events.subscribe('putCatalog', function () {
            if (treeRootId === null) return;
            internal.write('/StructTreeRoot ' + treeRootId + ' 0 R');
            internal.write('/MarkInfo <</Marked true>>');
            internal.write('/ViewerPreferences <</DisplayDocTitle true>>');
            internal.write('/Metadata ' + metadataId + ' 0 R');
        });

        function ref(id) { return id + ' 0 R'; }

        function xmp() {
            var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
            var packet =
                '<x:xmpmeta xmlns:x="adobe:ns:meta/">\n' +
                ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
                '  <rdf:Description rdf:about=""\n' +
                '    xmlns:dc="http://purl.org/dc/elements/1.1/"\n' +
                '    xmlns:xmp="http://ns.adobe.com/xap/1.0/"\n' +
                '    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"\n' +
                '    xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">\n' +
                '   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">' + xmlEscape(title) + '</rdf:li></rdf:Alt></dc:title>\n' +
                '   <dc:language><rdf:Bag><rdf:li>' + xmlEscape(lang) + '</rdf:li></rdf:Bag></dc:language>\n' +
                '   <xmp:CreateDate>' + now + '</xmp:CreateDate>\n' +
                '   <xmp:ModifyDate>' + now + '</xmp:ModifyDate>\n' +
                '   <xmp:CreatorTool>jsPDF + pdfua.js</xmp:CreatorTool>\n' +
                '   <pdf:Producer>jsPDF</pdf:Producer>\n' +
                '   <pdfuaid:part>1</pdfuaid:part>\n' +
                '  </rdf:Description>\n' +
                ' </rdf:RDF>\n' +
                '</x:xmpmeta>';
            return packet;
        }

        // Runs while jsPDF writes the file, right after the pages are written.
        function buildStructure() {
            if (!finished) return;

            // 1. Give every node an object id.
            var nodes = [];
            (function walk(n) {
                n.obj = internal.newAdditionalObject();
                nodes.push(n);
                n.kids.forEach(function (k) { if (k.type) walk(k); });
            })(root);

            var treeRoot = internal.newAdditionalObject();
            var parentTree = internal.newAdditionalObject();
            var meta = internal.newAdditionalObject();
            treeRootId = treeRoot.objId;
            metadataId = meta.objId;

            var pageCount = internal.getNumberOfPages();
            function pageRef(p) { return ref(internal.getPageInfo(p).objId); }

            // 2. Structure elements.
            nodes.forEach(function (n) {
                var parent = n.parent ? n.parent.obj.objId : treeRoot.objId;
                var firstPage = null;
                var kids = n.kids.map(function (k) {
                    if (k.type) return ref(k.obj.objId);
                    if (firstPage === null) firstPage = k.page;
                    if (k.annotIndex !== undefined) {
                        return '<</Type /OBJR /Pg ' + pageRef(k.page) + ' /Obj ' + ref(annotations[k.annotIndex].obj.objId) + '>>';
                    }
                    return '<</Type /MCR /Pg ' + pageRef(k.page) + ' /MCID ' + k.mcid + '>>';
                });
                var s = '<</Type /StructElem /S /' + n.type + ' /P ' + ref(parent);
                if (firstPage !== null) s += ' /Pg ' + pageRef(firstPage);
                if (n.alt) s += ' /Alt ' + pdfString(n.alt);
                if (n.type === 'Document') s += ' /Lang ' + pdfString(lang);
                s += ' /K [' + kids.join(' ') + ']>>';
                n.obj.content = s;
            });

            // 3. ParentTree: page -> [element per MCID], plus annotation StructParent -> Link element.
            var nums = [];
            for (var p = 1; p <= pageCount; p++) {
                var marks = pageMarks[p] || [];
                nums.push((p - 1) + ' [' + marks.map(function (n) { return ref(n.obj.objId); }).join(' ') + ']');
            }
            annotations.forEach(function (a, i) {
                nums.push((pageCount + i) + ' ' + ref(a.node.obj.objId));
            });

            parentTree.content = '<</Nums [' + nums.join(' ') + ']>>';
            treeRoot.content =
                '<</Type /StructTreeRoot /K ' + ref(root.obj.objId) +
                ' /ParentTree ' + ref(parentTree.objId) +
                ' /ParentTreeNextKey ' + (pageCount + annotations.length) + '>>';

            // 4. XMP metadata stream (must not be compressed or encrypted).
            var packet = xmp();
            meta.content = '<</Type /Metadata /Subtype /XML /Length ' + packet.length + '>>\nstream\n' + packet + '\nendstream';
        }

        internal.events.subscribe('postPutPages', buildStructure);

        // Call once, after the last drawing call and before doc.save() / doc.output().
        function finish() { finished = true; }

        return { open: open, close: close, text: text, link: link, finish: finish };
    }

    global.PdfUA = { create: create };
})(window);
