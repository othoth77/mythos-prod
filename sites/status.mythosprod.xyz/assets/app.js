// =====================================================
// MYTHOS STATUS CENTER — UI renderer
// sites/status.mythosprod.xyz/assets/app.js
//
// Renders the machine-readable review snapshot (data/current.json).
// SECURITY: strictly read-only; all data is rendered through
// textContent / createElement — never innerHTML with data — so a
// hostile string in the data model cannot become markup (XSS-safe by
// construction). No external requests: same-origin fetch only.
// =====================================================
'use strict';

(function () {
  var STATE = { data: null, index: null, timelineWindow: 'all', timelineProject: 'all',
    matrixSort: { key: null, dir: 1 } };

  // ── tiny DOM helpers (no innerHTML with data, ever) ─────────────
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k === 'dataset') Object.keys(attrs[k]).forEach(function (d) { n.dataset[d] = attrs[k][d]; });
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function txt(s) { return document.createTextNode(String(s)); }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function byId(id) { return document.getElementById(id); }

  var PILL_CLASS = {
    DONE: 's-done', READY: 's-ready', IN_PROGRESS: 's-progress',
    BLOCKED: 's-blocked', OWNER_ACTION: 's-owner', NOT_STARTED: 's-neutral',
    DEFERRED: 's-neutral', SUPERSEDED: 's-superseded', NOT_VERIFIED: 's-notverified',
    VERIFIED: 's-done', RECORDED: 's-neutral', NEW_DISCOVERY: 's-owner',
    CURRENT: 's-done', HISTORICAL: 's-neutral', CONFLICTING: 's-blocked',
    UNVERIFIED: 's-notverified', ACTIVE: 's-done', FOUNDATION: 's-neutral',
    OWNER_DIRECTION: 's-owner', FUTURE_CONCEPT: 's-neutral', ARCHIVED: 's-superseded',
    UNKNOWN: 's-notverified'
  };
  function pill(status) {
    return el('span', { class: 'pill ' + (PILL_CLASS[status] || 's-neutral'),
      text: String(status).replace(/_/g, ' ') });
  }
  function basisChip(basis) {
    return el('span', { class: 'basis', text: ' ' + basis });
  }
  function evRefs(data, refs) {
    var wrap = el('span', { class: 'evrefs' });
    (refs || []).forEach(function (r) {
      var ev = (data.evidence || []).find(function (e) { return e.id === r; });
      var label = ev ? (ev.type + ':' + ev.reference) : r;
      var chip = el('span', { class: 'evref', text: label, title: ev ? ((ev.note || '') + ' [' + ev.evidence_status + ']') : r });
      wrap.appendChild(chip);
    });
    return wrap;
  }

  // ── Simple-Arabic explanation layer ─────────────────────────────
  // Centralized secondary Arabic explanations, rendered UNDER the
  // primary English (never replacing it). These explain MEANING for a
  // non-technical reader; they never carry or alter data — status
  // values, numbers, percentages, hashes, dates and URLs stay exactly
  // as the data model provides them. Dynamic English from
  // data/current.json is preserved verbatim; the Arabic under it is
  // looked up here by stable key (state, project id, blocker id, exact
  // recorded title) — unknown keys simply render no Arabic line.
  var AR = {
    states: {
      DONE: 'مكتمل، ويوجد دليل يؤكد أن العمل تم فعلاً.',
      READY: 'تم بناء الجزء واختباره، لكنه ما زال ينتظر خطوة خارجية.',
      IN_PROGRESS: 'العمل جارٍ عليه حالياً.',
      BLOCKED: 'لا يمكن مواصلة العمل حالياً بسبب عائق موضح في قسم العوائق.',
      OWNER_ACTION: 'هذه الخطوة تحتاج إلى تدخل صاحب المشروع.',
      NOT_STARTED: 'لم يبدأ تنفيذ هذا الجزء بعد.',
      DEFERRED: 'تم تأجيله عمداً إلى وقت لاحق.',
      SUPERSEDED: 'حلّ محله عمل أحدث منه.',
      NOT_VERIFIED: 'تم ذكر أنه مكتمل، لكن لا يوجد حالياً دليل يمكن التحقق منه.',
      VERIFIED: 'تم التحقق منه بدليل فعلي.',
      RECORDED: 'مسجّل كمعلومة، دون تحقق مستقل منه.',
      NEW_DISCOVERY: 'اكتشاف جديد ظهر أثناء المراجعة.',
      CURRENT: 'وثيقة حديثة يمكن الاعتماد عليها.',
      HISTORICAL: 'وثيقة قديمة تُقرأ كتاريخ فقط، لا كحالة حالية.',
      CONFLICTING: 'وثيقة تتعارض مع مصادر أحدث منها، فلا يُعتمد عليها قبل المراجعة.',
      UNVERIFIED: 'غير مؤكد — لا يوجد دليل يمكن التحقق منه.',
      ACTIVE: 'مستودع نشط يجري العمل فيه.',
      FOUNDATION: 'مستودع تأسيسي مرجعي.',
      OWNER_DIRECTION: 'قرار أو توجيه صادر عن صاحب المشروع.',
      FUTURE_CONCEPT: 'فكرة مستقبلية لم يبدأ العمل عليها.',
      ARCHIVED: 'مؤرشف — محفوظ دون عمل جارٍ عليه.',
      UNKNOWN: 'حالته غير معروفة.'
    },
    projects: {
      'PROJECT-MYTHOS-OS': 'التطبيق الأساسي لإدارة الإنتاج: البرنامج الأصلي الذي تُدار به أعمال الشركة من المتصفح.',
      'PROJECT-MOS-V2': 'لوحة تحكم للمشغّل: إدارة المهام والأهداف، مع موافقة بشرية إلزامية قبل أي تنفيذ.',
      'PROJECT-COMMAND-CENTER': 'واجهة إرسال المهام: إنشاء مهمة، ومتابعة تقريرها، ونسخ التقرير بضغطة واحدة. تعمل فعلياً على الإنترنت.',
      'PROJECT-OTH-KNOWLEDGE': 'طبقة معرفة: تخزين المعلومات مع مصدر كل معلومة ودرجة الثقة فيها، دون اعتبار أي معلومة حقيقة مؤكدة تلقائياً.',
      'PROJECT-OTH-MASTER': 'محرك الذاكرة الشخصية لصاحب المشروع: حفظ معلوماته الخاصة واسترجاعها بشكل منضبط وموثّق المصدر.',
      'PROJECT-ID-AUTO': 'منصة هوية السيارات في تونس: لوحات السيارات، والملاحظات عليها، ومراجعة البيانات والصور.',
      'PROJECT-AUTOMOTIVE': 'المظلة العامة لمشاريع قطاع السيارات: تصميم وهيكلة فقط حتى الآن، دون أي تنفيذ.',
      'PROJECT-ATELIER-NETWORK': 'منتج شبكة ورشات الصيانة: ما زال في مرحلة التوثيق والتأسيس فقط.',
      'PROJECT-AUTOVALEUR': 'منتج تقييم أسعار السيارات: ما زال في مرحلة التخطيط فقط.',
      'PROJECT-SSANGYONG': 'موقع ssangyong.autos: قاعدة بيانات قطع الغيار وواجهة عرضها، ويعمل فعلياً على الإنترنت.',
      'PROJECT-AUTOMATION': 'الأتمتة المنضبطة: أدوات تنفّذ أعمالاً متكررة (كالنسخ الاحتياطي وإدارة النطاقات)، لكنها لا تعمل إلا بموافقة صاحب المشروع.',
      'PROJECT-INFRASTRUCTURE': 'البنية التحتية: الخادم الرئيسي والنطاقات وأنظمة التشغيل والنسخ الاحتياطي التي تقوم عليها كل المشاريع.',
      'PROJECT-VPS-FINAL-GATE': 'الفحص النهائي على الخادم نفسه: آخر تحقق شامل قبل اعتبار المنظومة جاهزة، وهو متوقف على توفير طريقة وصول.',
      'PROJECT-SECURITY': 'الأمان والحوكمة: القواعد والقيود التي تضمن ألا يحدث أي تنفيذ حساس دون إذن.',
      'PROJECT-AI-ORCHESTRATION': 'طبقة تشغيل الذكاء الاصطناعي: منفّذ يعمل على الخادم ويكمل مهام حقيقية ضمن ميزانية وقيود صارمة.',
      'PROJECT-DESIGN-SYSTEM': 'الهوية البصرية ونظام التصميم: الألوان والخطوط والمكوّنات الموحّدة لكل واجهات المنظومة.',
      'PROJECT-ECOSYSTEM-HUB': 'الصفحة العامة الرئيسية mythosprod.xyz: تعريف بالمنظومة ومنتجاتها. جاهزة لكنها غير منشورة بعد.',
      'PROJECT-STATUS-CENTER': 'هذه الصفحة نفسها: المرجع الوحيد لحالة كل المشاريع، بالأدلة، مع سجل مراجعات لا يتغيّر.',
      'PROJECT-MIGRATION': 'نقل البيانات وحمايتها: التأكد من أن الملفات والنسخ الاحتياطية محفوظة خارج الأجهزة المعرّضة للخطر.',
      'PROJECT-DEVX': 'أدوات داخلية لتسريع التطوير وتنظيمه.',
      'PROJECT-RESEARCH': 'طبقة بحث مستقبلية: توثيق فقط حتى الآن، دون تنفيذ.',
      'PROJECT-PORTFOLIO': 'المشاريع القديمة السابقة لمنظومة Mythos: محفوظة ومحمية، ومعظمها غير نشط.'
    },
    paths: {
      'SSH deploy@51.68.226.211 (AI session)': 'دخول جلسات الذكاء الاصطناعي إلى الخادم مباشرة: مغلق، وهذا مقصود.',
      'SSH owner Windows → VPS': 'دخول صاحب المشروع إلى الخادم من جهازه: يعمل وموثّق.',
      'HTTPS to VPS from AI session': 'اتصال جلسات الذكاء الاصطناعي بالخادم عبر الإنترنت: محجوب بسياسة الشبكة.',
      'DNS resolution (os./ordre./apex)': 'أسماء النطاقات تشير إلى الخادم الصحيح — لا توجد مشكلة في النطاقات.',
      'GitHub Actions / self-hosted runner': 'التنفيذ الآلي عبر GitHub: لم يُجهَّز بعد.',
      'Coolify': 'أداة النشر على الخادم: جاهزة، ومسموح باستعمالها في نطاق محدد فقط.',
      'n8n': 'أداة الأتمتة: نسخة واحدة تعمل، وهذا قرار نهائي.',
      'Executor HTTP API': 'منفّذ المهام داخل الخادم: يعمل، ولا يمكن الوصول إليه من خارج الخادم — عمداً.',
      'mythos-git-push relay': 'قناة تحديث الكود على الخادم: تسحب الكود فقط ولا تنفّذ أي أوامر واردة منه — خاصية أمان أساسية.',
      'Owner-dispatched executor missions': 'المهام التي يرسلها صاحب المشروع بنفسه: الطريقة الوحيدة العاملة حالياً لتنفيذ مهام الذكاء الاصطناعي على الخادم.'
    },
    blockers: {
      'BLOCKER-VPS-EXECUTION': 'لا توجد طريقة تسمح لجلسات الذكاء الاصطناعي بتنفيذ أعمال على الخادم مباشرة؛ كل تنفيذ يمر عبر صاحب المشروع.',
      'BLOCKER-DEPLOY-DOCKER-GROUP': 'حساب النشر على الخادم يملك صلاحيات أوسع من اللازم، وسحبها خطوة أمان مطلوبة من صاحب المشروع.',
      'BLOCKER-OTHK-STORE': 'مخزن المعرفة الخاص لم يُجهَّز بعد على الخادم.',
      'BLOCKER-OTHK-REAL-DATA': 'لا توجد بعدُ بيانات حقيقية مصرّح بها لتغذية طبقة المعرفة؛ صاحب المشروع هو من يوفّرها.',
      'BLOCKER-MOS-CONSOLE-DEPLOY': 'لوحة التحكم جاهزة ومختبرة، لكنها لم تُنشر بعد على الإنترنت.',
      'BLOCKER-STATUS-DNS': 'تم حلّه: هذه الصفحة أصبحت تعمل على عنوانها الصحيح.',
      'BLOCKER-HUB-DNS': 'الصفحة العامة الرئيسية جاهزة، لكن نطاقها لا يعرضها بعد.',
      'BLOCKER-IDA4-LEGAL': 'الواجهة الموجّهة للمواطنين في مشروع هوية السيارات متوقفة على مراجعة قانونية.',
      'BLOCKER-DNS-APPROVALS': 'نقل النطاقات إلى Cloudflare ينتظر موافقات صاحب المشروع، ولم تُمنح أي موافقة بعد.',
      'BLOCKER-SYA-NGINX-DRIFT': 'إعدادات الخادم الخاصة بموقع ssangyong.autos تختلف عن النسخة المسجلة في المستودع وتحتاج إلى مطابقة.',
      'BLOCKER-REPO-MIGRATION': 'نقل المستودع إلى اسم جديد غير مصرّح به — يجب عدم البدء فيه.',
      'BLOCKER-BACKUP-GATES': 'النسخ الاحتياطي الدوري خارج الخادم غير مجدول بعد؛ تفعيله يحتاج موافقة صاحب المشروع.'
    },
    ownerActions: {
      'Dispatch the VPS Final Gate mission (Option A)': 'إرسال مهمة الفحص النهائي للخادم حتى يكتمل آخر تحقق شامل.',
      'Remove deploy from the docker group': 'سحب صلاحية زائدة من حساب النشر على الخادم — خطوة أمان مهمة.',
      'Remove deploy from the docker group — COMPLETED 2026-08-20': 'سحب الصلاحية الزائدة من حساب النشر — أُنجز.',
      'Deploy the Status Center — COMPLETED 2026-08-20 (vhost + certificate deployed, LIVE)': 'نشر هذه الصفحة — أُنجز، وهي الآن تعمل فعلياً.',
      'Provision the OTH Knowledge private store': 'تجهيز مخزن المعرفة الخاص على الخادم.',
      'Produce authorized data exports (Takeout / Gemini / NotebookLM)': 'توفير نسخ مصرّح بها من البيانات الشخصية لتغذية طبقة المعرفة.',
      'Deploy the MOS-v2 console': 'نشر لوحة التحكم الجاهزة على الإنترنت.',
      'Create apex DNS and deploy the mythosprod.xyz hub': 'ربط النطاق الرئيسي ونشر الصفحة العامة للمنظومة.',
      'Engage legal review for ID Auto citizen surface': 'بدء المراجعة القانونية لواجهة المواطنين في مشروع هوية السيارات.'
    },
    nextActions: {
      'Dispatch the Option A VPS Final Gate mission': 'إرسال مهمة الفحص النهائي للخادم.',
      'Provision /home/deploy/othk-store and activate config/knowledge.json': 'تجهيز مجلد مخزن المعرفة على الخادم، ثم تفعيل الإعداد الخاص به.',
      'sudo gpasswd -d deploy docker, then re-run the governance invariant suite': 'تنفيذ أمر سحب الصلاحية الزائدة من حساب النشر، ثم إعادة تشغيل اختبارات الحوكمة للتأكد.',
      'Provision /home/deploy/othk-store and flip config/knowledge.json': 'تجهيز مجلد مخزن المعرفة على الخادم، ثم تفعيل الإعداد الخاص به.',
      'Execute the MOS-v2 Phase-B deployment runbook': 'تنفيذ خطوات نشر لوحة التحكم كما هي موثّقة.',
      'Produce authorized exports for OTH Knowledge Track B': 'توفير البيانات المصرّح بها لطبقة المعرفة.',
      'Create apex DNS and deploy the mythosprod.xyz hub': 'ربط النطاق الرئيسي ونشر الصفحة العامة.'
    },
    changeGroups: {
      'Completed': 'ما اكتمل منذ المراجعة السابقة.',
      'Unblocked': 'عوائق زالت.',
      'Newly blocked': 'أمور تعطّلت حديثاً.',
      'Added': 'عناصر أُضيفت.',
      'Changed': 'عناصر تغيّرت حالتها.',
      'Regressed': 'عناصر تراجعت حالتها.',
      'Superseded': 'عناصر حلّ محلها عمل أحدث.',
      'New blockers': 'عوائق جديدة ظهرت.',
      'Removed blockers': 'عوائق أُزيلت من القائمة.',
      'New owner actions': 'إجراءات جديدة مطلوبة من صاحب المشروع.',
      'Percent changes': 'نسب تقدّم تغيّرت.'
    },
    sources: {
      'Current GitHub code (othoth77/mythos-prod main)': 'الكود الحالي على GitHub — المرجع الأعلى لما هو منفَّذ فعلاً.',
      'Executed test results (recorded per stage with counts)': 'نتائج الاختبارات التي شُغِّلت فعلاً — مرجع التحقق.',
      'Live VPS / DNS / HTTPS evidence (operator-verified only)': 'الأدلة الحية من الخادم والنطاقات — مرجع ما هو منشور فعلاً.',
      'docs/AI_HANDOVER.md + docs/CHANGELOG.md + docs/AI_EXECUTION_REPORT.md': 'وثائق التسليم والتغييرات الحديثة — سياق تشغيلي حديث.',
      'Older status documents (PROJECT_STATE.md, PROJECT_STATUS.md, stale ROADMAP sections)': 'وثائق حالة قديمة — تُقرأ كتاريخ فقط، ولا يُعتمد عليها قبل مطابقتها بالمصادر الأحدث.'
    },
    misc: {
      sourceHierarchy: 'ترتيب الثقة في المصادر: عندما تختلف المصادر فيما بينها، نأخذ بالمصدر الأعلى في هذه القائمة.',
      timelineEmpty: 'لا توجد أحداث مسجلة في هذه الفترة.',
      noChanges: 'لا توجد تغييرات مسجلة مقارنة بالمراجعة السابقة.',
      notCalculable: 'لا يمكن حساب نسبة لهذا المسار، لأنه لا توجد له قائمة مراحل مسجلة.',
      compareNone: 'لا توجد فروق بين النسختين المختارتين.',
      loadError: 'تعذّر تحميل بيانات الصفحة. هذه الصفحة تعرض ملف البيانات المنشور معها — تأكد من أنه موجود.',
      reviewReloaded: 'أُعيد تحميل أحدث نسخة منشورة من البيانات.',
      reviewReadOnly: 'هذه الصفحة للعرض فقط ولا يمكنها تنفيذ أي أوامر. إنتاج مراجعة جديدة يتم بتشغيل محرّك المراجعة من نسخة المستودع، ثم نشر النتيجة هنا.'
    }
  };
  function arEl(text) {
    if (!text) return null;
    var n = el('p', { class: 'simple-ar', lang: 'ar', dir: 'rtl' });
    n.textContent = text;
    return n;
  }
  function arState(status) { return arEl(AR.states[status]); }
  // Append-if-present: an unknown key yields no Arabic line, never a crash.
  function arPut(parent, node) { if (node) parent.appendChild(node); }
  // "N of M recorded stages DONE" → simple Arabic with the SAME numbers
  // (numbers are reused verbatim, never recomputed or altered).
  function arTrackExplanation(explanation) {
    var m = /^(\d+) of (\d+) recorded stages DONE/.exec(explanation || '');
    if (m) return arEl('اكتملت ' + m[1] + ' من أصل ' + m[2] + ' مراحل مسجلة لهذا المسار.');
    return explanation ? arEl('النسبة محسوبة من عدد المراحل المكتملة من أصل المراحل المسجلة.') : null;
  }

  // ── header meta ─────────────────────────────────────────────────
  function renderMeta(d) {
    byId('m-review-id').textContent = d.review_id;
    byId('m-review-ts').textContent = d.timestamp.replace('T', ' ').slice(0, 16) + ' UTC';
    byId('m-head').textContent = (d.git.origin_main || 'NOT_VERIFIED').slice(0, 7);
    byId('m-repos').textContent = String((d.repositories || []).length);
    var blocked = (d.blockers || []).filter(function (b) { return b.status === 'BLOCKED'; }).length;
    byId('m-health').textContent = blocked ? blocked + ' blockers' : 'no blockers';
  }

  // ── executive cards ─────────────────────────────────────────────
  function renderExec(d) {
    var root = byId('exec-cards');
    clear(root);
    (d.projects || []).filter(function (p) { return p.executive; }).forEach(function (p) {
      var card = el('li', { class: 'card' });
      card.appendChild(el('h3', { text: p.name }));
      card.appendChild(pill(p.status));
      var dims = p.dimensions || {};
      Object.keys(dims).forEach(function (k) {
        var v = dims[k];
        var row = el('p');
        row.appendChild(txt(k + ': '));
        if (typeof v.percent === 'number') {
          row.appendChild(txt(v.percent + '%'));
          row.appendChild(basisChip(v.basis || 'CALCULATED'));
          var bar = el('span', { class: 'bar' }, [el('span')]);
          bar.firstChild.style.width = v.percent + '%';
          row.appendChild(bar);
        } else if (v.status) {
          row.appendChild(pill(v.status));
        } else {
          row.appendChild(txt('NOT CALCULABLE'));
        }
        if (v.note) row.appendChild(txt(' — ' + v.note));
        card.appendChild(row);
      });
      if (p.headline) card.appendChild(el('p', { text: p.headline }));
      arPut(card, arEl(AR.projects[p.id]));
      arPut(card, arState(p.status));
      root.appendChild(card);
    });
  }

  // ── legend + source hierarchy ───────────────────────────────────
  function renderLegend(d) {
    var root = byId('legend-body');
    clear(root);
    var states = ['DONE', 'READY', 'IN_PROGRESS', 'BLOCKED', 'OWNER_ACTION',
      'NOT_STARTED', 'DEFERRED', 'SUPERSEDED', 'NOT_VERIFIED'];
    var meaning = {
      DONE: 'complete, with evidence', READY: 'built and validated, awaiting an external step',
      IN_PROGRESS: 'actively being worked', BLOCKED: 'cannot proceed — see blockers',
      OWNER_ACTION: 'only the owner can move this', NOT_STARTED: 'no work exists yet',
      DEFERRED: 'deliberately postponed', SUPERSEDED: 'replaced by later work',
      NOT_VERIFIED: 'claimed somewhere, but not verifiable from here'
    };
    var ul = el('ul', { class: 'plain' });
    states.forEach(function (s) {
      var li = el('li');
      li.appendChild(pill(s));
      li.appendChild(txt(' ' + meaning[s]));
      arPut(li, arState(s));
      ul.appendChild(li);
    });
    root.appendChild(ul);
    if ((d.source_hierarchy || []).length) {
      root.appendChild(el('p', { class: 'section-note', text: 'Source hierarchy — when sources disagree, the higher authority wins:' }));
      root.appendChild(arEl(AR.misc.sourceHierarchy));
      var ol = el('ol');
      d.source_hierarchy.forEach(function (s) {
        var li2 = el('li', { text: s.source + ' — ' + s.authority });
        arPut(li2, arEl(AR.sources[s.source]));
        ol.appendChild(li2);
      });
      root.appendChild(ol);
    }
  }

  // ── project matrix ──────────────────────────────────────────────
  var MATRIX_COLS = [
    ['name', 'Project'], ['purpose', 'Purpose'], ['status', 'Status'],
    ['maturity', 'Maturity'], ['blocker', 'Blocker'], ['next_action', 'Next action'],
    ['last_change', 'Last change']
  ];
  function matrixRows(d) {
    var q = (byId('matrix-search').value || '').toLowerCase();
    var st = byId('matrix-status').value;
    var rows = (d.projects || []).slice();
    if (q) rows = rows.filter(function (p) {
      return (p.name + ' ' + p.purpose + ' ' + p.id).toLowerCase().indexOf(q) !== -1;
    });
    if (st && st !== 'all') rows = rows.filter(function (p) { return p.status === st; });
    var s = STATE.matrixSort;
    if (s.key) rows.sort(function (a, b) {
      var x = String(a[s.key] || ''), y = String(b[s.key] || '');
      return x < y ? -s.dir : x > y ? s.dir : 0;
    });
    return rows;
  }
  function renderMatrix(d) {
    var wrap = byId('matrix-wrap');
    clear(wrap);
    var thead = el('thead');
    var hr = el('tr');
    MATRIX_COLS.forEach(function (c) {
      var th = el('th', { text: c[1], tabindex: '0', role: 'button' });
      th.addEventListener('click', function () {
        STATE.matrixSort = { key: c[0], dir: STATE.matrixSort.key === c[0] ? -STATE.matrixSort.dir : 1 };
        renderMatrix(d);
      });
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    var tbody = el('tbody');
    matrixRows(d).forEach(function (p) {
      var tr = el('tr', { class: 'rowlink', tabindex: '0' });
      tr.appendChild(el('td', {}, [el('strong', { text: p.name }), el('br'), el('span', { class: 'mono', text: p.id })]));
      var tdP = el('td', { text: p.purpose });
      arPut(tdP, arEl(AR.projects[p.id]));
      tr.appendChild(tdP);
      var tdS = el('td'); tdS.appendChild(pill(p.status)); tr.appendChild(tdS);
      tr.appendChild(el('td', { class: 'mono', text: (p.maturity || '').replace(/_/g, ' ') }));
      tr.appendChild(el('td', { text: p.blocker || '—' }));
      tr.appendChild(el('td', { text: p.next_action || '—' }));
      tr.appendChild(el('td', { class: 'mono', text: p.last_change || '—' }));
      function open() { openProjectDrawer(d, p); }
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
      tbody.appendChild(tr);
    });
    var table = el('table', { class: 'matrix' }, [thead, tbody]);
    wrap.appendChild(table);
  }
  function initMatrixControls(d) {
    var sel = byId('matrix-status');
    clear(sel);
    sel.appendChild(el('option', { value: 'all', text: 'All statuses' }));
    ['DONE', 'READY', 'IN_PROGRESS', 'BLOCKED', 'OWNER_ACTION', 'NOT_STARTED', 'DEFERRED', 'SUPERSEDED', 'NOT_VERIFIED']
      .forEach(function (s) { sel.appendChild(el('option', { value: s, text: s.replace(/_/g, ' ') })); });
    sel.addEventListener('change', function () { renderMatrix(d); });
    byId('matrix-search').addEventListener('input', function () { renderMatrix(d); });
  }

  // ── project detail drawer ───────────────────────────────────────
  function openProjectDrawer(d, p) {
    var drawer = byId('detail-drawer');
    byId('drawer-title').textContent = p.name + ' — ' + p.id;
    var body = byId('drawer-body');
    clear(body);
    body.appendChild(pill(p.status));
    arPut(body, arState(p.status));
    body.appendChild(el('p', { text: p.purpose }));
    arPut(body, arEl(AR.projects[p.id]));
    if (p.headline) body.appendChild(el('p', { text: p.headline }));

    var kv = el('dl', { class: 'kv' });
    function row(k, v) {
      kv.appendChild(el('dt', { text: k }));
      kv.appendChild(el('dd', { text: v }));
    }
    row('Maturity', (p.maturity || '').replace(/_/g, ' '));
    if (p.repository) row('Repository', p.repository);
    if (p.last_change) row('Last change', p.last_change);
    if (p.blocker) row('Blocker', p.blocker);
    if (p.next_action) row('Next action', p.next_action);
    body.appendChild(kv);

    var dims = p.dimensions || {};
    if (Object.keys(dims).length) {
      body.appendChild(el('h4', { text: 'Dimensions' }));
      var ul = el('ul', { class: 'plain' });
      Object.keys(dims).forEach(function (k) {
        var v = dims[k];
        var li = el('li');
        li.appendChild(txt(k + ': '));
        if (typeof v.percent === 'number') { li.appendChild(txt(v.percent + '% ')); li.appendChild(basisChip(v.basis || 'CALCULATED')); }
        else if (v.status) li.appendChild(pill(v.status));
        else li.appendChild(txt('NOT CALCULABLE'));
        if (v.note) li.appendChild(txt(' — ' + v.note));
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }

    var tracks = (d.tracks || []).filter(function (t) { return t.project === p.id; });
    tracks.forEach(function (t) {
      body.appendChild(el('h4', { text: 'Stages — ' + t.name }));
      var ul2 = el('ul', { class: 'plain' });
      (t.stages || []).forEach(function (s) {
        var li = el('li');
        li.appendChild(el('strong', { text: s.id + ' ' }));
        li.appendChild(pill(s.status));
        if (s.what) li.appendChild(txt(' ' + s.what));
        if (s.tests) li.appendChild(el('span', { class: 'mono', text: ' · ' + s.tests }));
        li.appendChild(el('br'));
        li.appendChild(evRefs(d, s.evidence));
        ul2.appendChild(li);
      });
      body.appendChild(ul2);
    });

    var ms = (d.milestones || []).filter(function (m) { return m.project === p.id; }).slice(-8).reverse();
    if (ms.length) {
      body.appendChild(el('h4', { text: 'Recent history' }));
      var ul3 = el('ul', { class: 'plain' });
      ms.forEach(function (m) {
        var li = el('li');
        li.appendChild(el('span', { class: 'mono', text: m.date + ' ' }));
        li.appendChild(txt(m.title));
        ul3.appendChild(li);
      });
      body.appendChild(ul3);
    }

    var dnr = (d.do_not_reopen || []).filter(function (x) { return x.project === p.id; });
    if (dnr.length) {
      body.appendChild(el('h4', { text: 'Do not reopen' }));
      var ul4 = el('ul', { class: 'plain' });
      dnr.forEach(function (x) { ul4.appendChild(el('li', { text: x.item + (x.reason ? ' — ' + x.reason : '') })); });
      body.appendChild(ul4);
    }

    if (p.evidence && p.evidence.length) {
      body.appendChild(el('h4', { text: 'Evidence' }));
      body.appendChild(evRefs(d, p.evidence));
    }
    drawer.showModal();
  }

  // ── tracks ──────────────────────────────────────────────────────
  function renderTracks(d) {
    var root = byId('track-cards');
    clear(root);
    (d.tracks || []).forEach(function (t) {
      var card = el('li', { class: 'card' });
      card.appendChild(el('h3', { text: t.name }));
      var pr = t.progress || {};
      var row = el('p');
      if (typeof pr.percent === 'number') {
        row.appendChild(txt(pr.percent + '% '));
        row.appendChild(basisChip(pr.basis || 'CALCULATED'));
        var bar = el('span', { class: 'bar' }, [el('span')]);
        bar.firstChild.style.width = pr.percent + '%';
        row.appendChild(bar);
      } else {
        row.appendChild(txt('NOT CALCULABLE'));
      }
      card.appendChild(row);
      if (pr.explanation) card.appendChild(el('p', { text: pr.explanation }));
      if (typeof pr.percent === 'number') arPut(card, arTrackExplanation(pr.explanation));
      else arPut(card, arEl(AR.misc.notCalculable));
      if (t.note) card.appendChild(el('p', { text: t.note }));
      var open = el('button', { type: 'button', text: 'Stages (' + (t.stages || []).length + ')' });
      open.addEventListener('click', function () {
        var proj = (d.projects || []).find(function (p) { return p.id === t.project; });
        if (proj) openProjectDrawer(d, proj);
      });
      card.appendChild(el('p', {}, [open]));
      root.appendChild(card);
    });
  }

  // ── infrastructure / VPS ────────────────────────────────────────
  function renderInfra(d) {
    var root = byId('infra-body');
    clear(root);
    var items = d.infrastructure || (d.projects || []).find(function (p) { return p.id === 'PROJECT-INFRASTRUCTURE'; });
    var list = (d.execution_paths || []);
    if (!list.length && items && items.paths) list = items.paths;
    var ul = el('ul', { class: 'plain' });
    ((d.projects.find(function (p) { return p.id === 'PROJECT-INFRASTRUCTURE'; }) || {}).paths || []).forEach(function (pth) {
      var li = el('li');
      li.appendChild(el('strong', { text: pth.name + ' ' }));
      li.appendChild(pill(pth.status));
      if (pth.note) li.appendChild(txt(' — ' + pth.note));
      arPut(li, arEl(AR.paths[pth.name]) || arState(pth.status));
      ul.appendChild(li);
    });
    root.appendChild(ul);
  }

  // ── timeline ────────────────────────────────────────────────────
  var WINDOWS = [
    ['all', 'Whole history'], ['6m', '6 months'], ['3m', '3 months'], ['1m', '1 month'],
    ['3w', '3 weeks'], ['1w', '1 week'], ['yesterday', 'Yesterday'], ['today', 'Today']
  ];
  function windowStart(w, nowStr) {
    var now = new Date(nowStr + 'T00:00:00Z');
    function back(days) { var t = new Date(now); t.setUTCDate(t.getUTCDate() - days); return t.toISOString().slice(0, 10); }
    switch (w) {
      case '6m': return back(182);
      case '3m': return back(91);
      case '1m': return back(30);
      case '3w': return back(21);
      case '1w': return back(7);
      case 'yesterday': return back(1);
      case 'today': return nowStr;
      default: return '0000-00-00';
    }
  }
  function renderTimeline(d) {
    var filters = byId('timeline-filters');
    clear(filters);
    WINDOWS.forEach(function (w) {
      var b = el('button', { type: 'button', text: w[1] });
      b.setAttribute('aria-pressed', STATE.timelineWindow === w[0] ? 'true' : 'false');
      b.addEventListener('click', function () { STATE.timelineWindow = w[0]; renderTimeline(d); });
      filters.appendChild(b);
    });
    var sel = el('select', { 'aria-label': 'Filter timeline by project' });
    sel.appendChild(el('option', { value: 'all', text: 'All projects' }));
    (d.projects || []).forEach(function (p) {
      sel.appendChild(el('option', { value: p.id, text: p.name }));
    });
    sel.value = STATE.timelineProject;
    sel.addEventListener('change', function () { STATE.timelineProject = sel.value; renderTimeline(d); });
    filters.appendChild(sel);

    var today = d.timestamp.slice(0, 10);
    var start = windowStart(STATE.timelineWindow, today);
    var end = STATE.timelineWindow === 'yesterday'
      ? windowStart('yesterday', today) : today;

    var list = byId('timeline-list');
    clear(list);
    var ms = (d.milestones || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    ms = ms.filter(function (m) {
      if (m.date < start) return false;
      if (STATE.timelineWindow === 'yesterday' && m.date !== end) return false;
      if (STATE.timelineWindow === 'today' && m.date !== today) return false;
      if (STATE.timelineProject !== 'all' && m.project !== STATE.timelineProject) return false;
      return true;
    });
    if (!ms.length) {
      list.appendChild(el('li', {}, [el('p', { text: 'No recorded milestones in this window.' }),
        arEl(AR.misc.timelineEmpty)]));
      return;
    }
    ms.forEach(function (m) {
      var li = el('li');
      li.appendChild(el('span', { class: 't-date', text: m.date + (m.project ? ' · ' + m.project.replace('PROJECT-', '') : '') }));
      var h = el('h3');
      h.appendChild(txt(m.title + ' '));
      if (m.status) h.appendChild(pill(m.status));
      li.appendChild(h);
      if (m.what) li.appendChild(el('p', { text: m.what }));
      if (m.result) li.appendChild(el('p', { text: '→ ' + m.result }));
      if (m.superseded_by) li.appendChild(el('p', { text: 'Superseded by: ' + m.superseded_by }));
      li.appendChild(evRefs(d, m.evidence));
      list.appendChild(li);
    });
  }

  // ── what changed ────────────────────────────────────────────────
  function changeList(title, entries, fmt) {
    if (!entries || !entries.length) return null;
    var card = el('div', { class: 'card' });
    card.appendChild(el('h3', { text: title + ' (' + entries.length + ')' }));
    arPut(card, arEl(AR.changeGroups[title]));
    var ul = el('ul', { class: 'plain' });
    entries.forEach(function (e) { ul.appendChild(el('li', { text: fmt(e) })); });
    card.appendChild(ul);
    return card;
  }
  function renderChanged(d) {
    var root = byId('changed-body');
    clear(root);
    var ch = d.changes || {};
    if (ch.note) { root.appendChild(el('p', { class: 'section-note', text: ch.note })); }
    if (d.previous_review) {
      root.appendChild(el('p', { class: 'section-note', text: 'Compared against ' + d.previous_review + '.' }));
    }
    var grid = el('div', { class: 'cards' });
    function f(e) {
      var s = e.id;
      if (e.what) s += ' — ' + e.what;
      if (e.from !== undefined) s += ': ' + e.from + ' → ' + e.to;
      else if (e.to) s += ' → ' + e.to;
      if (e.title) s += ' — ' + e.title;
      return s;
    }
    [['Completed', ch.completed], ['Unblocked', ch.unblocked], ['Newly blocked', ch.blocked],
     ['Added', ch.added], ['Changed', ch.changed], ['Regressed', ch.regressed],
     ['Superseded', ch.superseded], ['New blockers', ch.new_blockers],
     ['Removed blockers', ch.removed_blockers], ['New owner actions', ch.new_owner_actions],
     ['Percent changes', ch.percent_changes]
    ].forEach(function (pair) {
      var c = changeList(pair[0], pair[1], f);
      if (c) grid.appendChild(c);
    });
    if (!grid.childNodes.length) {
      root.appendChild(el('p', { class: 'section-note', text: 'No changes recorded against the previous review.' }));
      root.appendChild(arEl(AR.misc.noChanges));
    } else root.appendChild(grid);
  }

  // ── blockers / owner actions / next actions / do-not-reopen ─────
  function renderBlockers(d) {
    var root = byId('blockers-list');
    clear(root);
    (d.blockers || []).slice().sort(function (a, b) { return a.priority < b.priority ? -1 : 1; })
      .forEach(function (b) {
        var li = el('li');
        li.appendChild(el('strong', { text: '[' + b.priority + '] ' + b.title + ' ' }));
        li.appendChild(pill(b.status));
        arPut(li, arEl(AR.blockers[b.id]) || arState(b.status));
        var kv = el('dl', { class: 'kv' });
        [['Type', b.type], ['Project', b.project], ['Owner', b.owner], ['Impact', b.impact],
         ['Required input', b.required_input], ['How to unblock', b.unblock],
         ['Created', b.created], ['Last checked', b.last_checked]]
          .forEach(function (p2) {
            if (!p2[1]) return;
            kv.appendChild(el('dt', { text: p2[0] }));
            kv.appendChild(el('dd', { text: p2[1] }));
          });
        li.appendChild(kv);
        li.appendChild(evRefs(d, b.evidence));
        root.appendChild(li);
      });
  }
  function renderOwner(d) {
    var root = byId('owner-list');
    clear(root);
    (d.owner_actions || []).forEach(function (a) {
      var li = el('li');
      li.appendChild(el('strong', { text: a.what + ' ' }));
      li.appendChild(pill(a.status));
      arPut(li, arEl(AR.ownerActions[a.what]) || arState(a.status));
      var kv = el('dl', { class: 'kv' });
      [['Why', a.why], ['Impact', a.impact], ['Required input', a.required_input],
       ['Expected result', a.expected_result], ['Procedure', a.procedure]]
        .forEach(function (p2) {
          if (!p2[1]) return;
          kv.appendChild(el('dt', { text: p2[0] }));
          kv.appendChild(el('dd', { text: p2[1] }));
        });
      li.appendChild(kv);
      root.appendChild(li);
    });
  }
  function renderNext(d) {
    var root = byId('next-list');
    clear(root);
    (d.next_actions || []).slice().sort(function (a, b) { return a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : (a.order || 0) - (b.order || 0); })
      .forEach(function (a) {
        var li = el('li');
        li.appendChild(el('strong', { text: '[' + a.priority + '] ' + a.title }));
        if (a.detail) li.appendChild(el('p', { text: a.detail }));
        arPut(li, arEl(AR.nextActions[a.title]));
        if (a.depends_on) li.appendChild(el('p', { class: 'mono', text: 'depends on: ' + a.depends_on }));
        root.appendChild(li);
      });
  }
  function renderDnr(d) {
    var root = byId('dnr-list');
    clear(root);
    (d.do_not_reopen || []).forEach(function (x) {
      var li = el('li');
      li.appendChild(el('strong', { text: x.item + ' ' }));
      li.appendChild(pill('DONE'));
      if (x.reason) li.appendChild(el('p', { text: x.reason }));
      li.appendChild(evRefs(d, x.evidence));
      root.appendChild(li);
    });
  }

  // ── documents / repositories ────────────────────────────────────
  function renderDocs(d) {
    var wrap = byId('docs-wrap');
    clear(wrap);
    var thead = el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Document' }), el('th', { text: 'Class' }), el('th', { text: 'Note' })
    ])]);
    var tbody = el('tbody');
    (d.documents || []).forEach(function (doc) {
      var tr = el('tr');
      tr.appendChild(el('td', { class: 'mono', text: doc.path + (doc.exists === false ? ' (missing)' : '') }));
      var td = el('td'); td.appendChild(pill(doc.classification));
      arPut(td, arState(doc.classification)); tr.appendChild(td);
      tr.appendChild(el('td', { text: doc.note || '' }));
      tbody.appendChild(tr);
    });
    wrap.appendChild(el('table', { class: 'matrix' }, [thead, tbody]));
  }
  function renderRepos(d) {
    var wrap = byId('repos-wrap');
    clear(wrap);
    var thead = el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Repository' }), el('th', { text: 'Classification' }),
      el('th', { text: 'Last push' }), el('th', { text: 'Note' })
    ])]);
    var tbody = el('tbody');
    (d.repositories || []).forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', { class: 'mono', text: r.full_name + (r.visibility ? ' (' + r.visibility + ')' : '') }));
      var td = el('td'); td.appendChild(pill(r.classification));
      arPut(td, arState(r.classification)); tr.appendChild(td);
      tr.appendChild(el('td', { class: 'mono', text: (r.pushed_at || '—').slice(0, 10) }));
      tr.appendChild(el('td', { text: r.note || '' }));
      tbody.appendChild(tr);
    });
    wrap.appendChild(el('table', { class: 'matrix' }, [thead, tbody]));
  }

  // ── review history + comparison ─────────────────────────────────
  function renderHistory(d, index) {
    var root = byId('history-body');
    clear(root);
    var ul = el('ul', { class: 'plain' });
    (index.reviews || []).slice().reverse().forEach(function (r) {
      var li = el('li');
      li.appendChild(el('strong', { class: 'mono', text: r.review_id }));
      li.appendChild(txt(' · ' + r.timestamp.replace('T', ' ').slice(0, 16) + ' UTC · main ' + String(r.head || '').slice(0, 7) + ' · '));
      var a = el('a', { href: r.file, text: 'open snapshot' });
      li.appendChild(a);
      ul.appendChild(li);
    });
    root.appendChild(ul);

    ['cmp-a', 'cmp-b'].forEach(function (id) {
      var sel = byId(id);
      clear(sel);
      (index.reviews || []).forEach(function (r) {
        sel.appendChild(el('option', { value: r.file, text: r.review_id }));
      });
    });
    var reviews = index.reviews || [];
    if (reviews.length > 1) {
      byId('cmp-a').value = reviews[reviews.length - 2].file;
      byId('cmp-b').value = reviews[reviews.length - 1].file;
    }
  }

  // Client-side snapshot comparison (mirror of the engine's semantics).
  function diffSnapshots(a, b) {
    var out = [];
    var pa = {}, pb = {};
    (a.projects || []).forEach(function (p) { pa[p.id] = p; });
    (b.projects || []).forEach(function (p) { pb[p.id] = p; });
    Object.keys(pb).forEach(function (id) {
      if (!pa[id]) out.push({ kind: 'NEW PROJECT', text: id + ' (' + pb[id].status + ')' });
      else if (pa[id].status !== pb[id].status) out.push({ kind: 'STATUS', text: id + ': ' + pa[id].status + ' → ' + pb[id].status });
    });
    var ba = {}, bb = {};
    (a.blockers || []).forEach(function (x) { ba[x.id] = x; });
    (b.blockers || []).forEach(function (x) { bb[x.id] = x; });
    Object.keys(bb).forEach(function (id) { if (!ba[id]) out.push({ kind: 'NEW BLOCKER', text: id + ' — ' + bb[id].title }); });
    Object.keys(ba).forEach(function (id) { if (!bb[id]) out.push({ kind: 'BLOCKER REMOVED', text: id + ' — ' + ba[id].title }); });
    var ta = {}, tb = {};
    (a.tracks || []).forEach(function (t) { ta[t.id] = t; });
    (b.tracks || []).forEach(function (t) { tb[t.id] = t; });
    Object.keys(tb).forEach(function (id) {
      var x = ta[id] && ta[id].progress ? ta[id].progress.percent : undefined;
      var y = tb[id].progress ? tb[id].progress.percent : undefined;
      if (ta[id] && x !== y) out.push({ kind: 'PERCENT', text: id + ': ' + x + ' → ' + y });
    });
    return out;
  }
  function initCompare() {
    byId('btn-compare').addEventListener('click', function () {
      var fa = byId('cmp-a').value, fb = byId('cmp-b').value;
      if (!fa || !fb) return;
      Promise.all([fetch(fa).then(function (r) { return r.json(); }),
                   fetch(fb).then(function (r) { return r.json(); })])
        .then(function (pair) {
          var out = byId('compare-body');
          clear(out);
          out.appendChild(el('h3', { text: pair[0].review_id + ' → ' + pair[1].review_id }));
          var diffs = diffSnapshots(pair[0], pair[1]);
          if (!diffs.length) {
            out.appendChild(el('p', { class: 'section-note', text: 'No differences between the selected snapshots.' }));
            out.appendChild(arEl(AR.misc.compareNone));
            return;
          }
          var ul = el('ul', { class: 'plain' });
          diffs.forEach(function (x) {
            var li = el('li');
            li.appendChild(el('strong', { class: 'mono', text: x.kind + ' ' }));
            li.appendChild(txt(x.text));
            ul.appendChild(li);
          });
          out.appendChild(ul);
        });
    });
  }

  // ── REVIEW NOW ──────────────────────────────────────────────────
  // The browser is a read-only surface (order §35): it must never
  // execute repository or VPS commands. [REVIEW NOW] therefore
  // (1) re-fetches the latest published snapshot, and (2) shows the
  // exact deterministic operator command that produces a new one.
  function initReviewNow() {
    byId('btn-review-now').addEventListener('click', function () {
      load(true).then(function () {
        var body = byId('review-drawer-body');
        clear(body);
        body.appendChild(el('p', { text: 'Latest published snapshot reloaded: ' + STATE.data.review_id + ' (' + STATE.data.timestamp.replace('T', ' ').slice(0, 16) + ' UTC).' }));
        body.appendChild(arEl(AR.misc.reviewReloaded));
        body.appendChild(el('p', { text: 'This page is read-only by design — it cannot run repository commands. A new review is produced by the review engine, run from a repository checkout:' }));
        body.appendChild(el('p', { class: 'mono', text: 'node projects/status-center/bin/review.js' }));
        body.appendChild(el('p', { text: 'The engine reconciles git facts, the evidence registry, the PR ledger and document classification, writes an immutable snapshot under reviews/, and updates this page’s data. Commit and deploy the result to publish it here.' }));
        body.appendChild(arEl(AR.misc.reviewReadOnly));
        byId('review-drawer').showModal();
      });
    });
    byId('review-drawer-close').addEventListener('click', function () { byId('review-drawer').close(); });
    byId('drawer-close').addEventListener('click', function () { byId('detail-drawer').close(); });
  }

  // ── boot ────────────────────────────────────────────────────────
  function renderAll() {
    var d = STATE.data;
    renderMeta(d);
    renderExec(d);
    renderLegend(d);
    initMatrixControls(d);
    renderMatrix(d);
    renderTracks(d);
    renderInfra(d);
    renderTimeline(d);
    renderChanged(d);
    renderBlockers(d);
    renderOwner(d);
    renderNext(d);
    renderDnr(d);
    renderDocs(d);
    renderRepos(d);
    renderHistory(d, STATE.index);
  }
  function load(soft) {
    return Promise.all([
      fetch('data/current.json', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('current.json HTTP ' + r.status);
        return r.json();
      }),
      fetch('data/reviews-index.json', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) return { reviews: [] };
        return r.json();
      })
    ]).then(function (pair) {
      STATE.data = pair[0];
      STATE.index = pair[1];
      renderAll();
    }).catch(function (e) {
      var err = byId('load-error');
      err.hidden = false;
      err.textContent = 'Could not load the status data model (' + e.message + '). The dashboard renders data/current.json — verify it is deployed alongside this page.';
      err.appendChild(arEl(AR.misc.loadError));
      if (soft) throw e;
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initReviewNow();
    initCompare();
    load(false);
  });
})();
