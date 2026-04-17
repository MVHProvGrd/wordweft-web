// ============================================================================
// StoryAnalyzer — WordWeft Web Client
// Port of Android StoryAnalyzer.kt + WordRarityAnalyzer.kt
//
// WIREFRAME: This file is structured in 5 chunks for incremental development.
// Currently provides stub implementations that return reasonable defaults.
// Each chunk can be filled in independently.
// ============================================================================

// ─── CHUNK 1: Word Rarity System ──────────────────────────────────────────────
// Port of WordRarityAnalyzer.kt (~100 lines when complete)
// Dependencies: None
const WordRarity = (() => {
    const LanguageLevel = {
        ROOKIE:   { code: 'A1', label: 'Rookie',    score: 1.0, multiplier: 1.0 },
        EXPLORER: { code: 'A2', label: 'Explorer',  score: 2.0, multiplier: 1.2 },
        CRAFTER:  { code: 'B1', label: 'Crafter',   score: 3.0, multiplier: 1.5 },
        WEAVER:   { code: 'B2', label: 'Weaver',    score: 4.0, multiplier: 1.8 },
        MASTER:   { code: 'C1', label: 'Master',    score: 5.0, multiplier: 2.2 },
        SAGE:     { code: 'C2', label: 'Sage',      score: 6.0, multiplier: 2.5 }
    };

    // CEFR dictionary loaded asynchronously from /word_cefr.tsv.
    // Until it's loaded, getWordLevel falls back to length heuristics; once
    // loaded, unknown words return ROOKIE so misspellings/gibberish can't
    // masquerade as rare vocabulary.
    let cefrMap = null;
    let loadPromise = null;

    function codeToLevel(code) {
        switch ((code || '').toUpperCase()) {
            case 'C2': return LanguageLevel.SAGE;
            case 'C1': return LanguageLevel.MASTER;
            case 'B2': return LanguageLevel.WEAVER;
            case 'B1': return LanguageLevel.CRAFTER;
            case 'A2': return LanguageLevel.EXPLORER;
            case 'A1':
            default:   return LanguageLevel.ROOKIE;
        }
    }

    function load() {
        if (loadPromise) return loadPromise;
        loadPromise = fetch('word_cefr.tsv')
            .then(r => r.ok ? r.text() : '')
            .then(txt => {
                const m = new Map();
                const lines = txt.split('\n');
                for (const line of lines) {
                    const tab = line.indexOf('\t');
                    if (tab < 0) continue;
                    const word = line.substring(0, tab).toLowerCase();
                    const code = line.substring(tab + 1).trim();
                    if (word) m.set(word, code);
                }
                cefrMap = m;
            })
            .catch(() => { cefrMap = new Map(); });
        return loadPromise;
    }
    // Kick off the fetch as soon as the module is evaluated.
    load();

    // TODO: Fill with ~70 common A1 words from WordRarityAnalyzer.kt
    const a1Words = new Set([
        'the','a','an','is','am','are','was','were','be','been','being',
        'have','has','had','do','does','did','will','would','shall','should',
        'may','might','can','could','must','i','you','he','she','it','we',
        'they','me','him','her','us','them','my','your','his','its','our',
        'their','this','that','these','those','what','which','who','whom',
        'and','but','or','if','when','where','how','not','no','yes',
        'in','on','at','to','for','with','from','by','of','up','out',
        'go','come','get','make','take','see','know','say','think','give'
    ]);

    // TODO: Fill with ~50 A2 words
    const a2Words = new Set([
        'beautiful','important','different','interesting','difficult','possible',
        'necessary','available','special','general','particular','significant',
        'traditional','cultural','political','international','environmental',
        'situation','experience','information','development','relationship',
        'government','education','community','technology','opportunity',
        'remember','understand','consider','continue','describe','explain',
        'improve','suggest','achieve','discover','establish','imagine',
        'already','usually','sometimes','probably','certainly','especially',
        'actually','recently','suddenly','immediately','obviously','fortunately'
    ]);

    // TODO: Fill with ~44 B1 words
    const b1Words = new Set([
        'magnificent','extraordinary','sophisticated','comprehensive','fundamental',
        'contemporary','controversial','remarkable','substantial','inevitable',
        'accommodate','acknowledge','demonstrate','distinguish','elaborate',
        'exaggerate','investigate','manipulate','participate','predominant',
        'reluctantly','simultaneously','spontaneously','subsequently','tremendously',
        'bureaucracy','consciousness','contradiction','discrimination','infrastructure',
        'phenomenon','perspective','prerequisite','significance','vulnerability',
        'ambiguous','conspicuous','diligent','eloquent','meticulous',
        'tenacious','versatile','pragmatic','indigenous'
    ]);

    // TODO: Fill with ~41 B2 words
    const b2Words = new Set([
        'ubiquitous','paradigm','dichotomy','juxtaposition','epitome',
        'quintessential','unprecedented','idiosyncratic','serendipitous','ephemeral',
        'ameliorate','exacerbate','circumvent','corroborate','disseminate',
        'extrapolate','hypothesize','interpolate','promulgate','substantiate',
        'anomalous','antithetical','burgeoning','catalytic','deleterious',
        'equivocal','heterogeneous','incongruous','paradoxical','superfluous',
        'algorithm','conundrum','lexicon','nomenclature','taxonomy',
        'zeitgeist','archetype','diaspora','hegemony','synergy','ethos'
    ]);

    // TODO: Fill with ~40 C1 words
    const c1Words = new Set([
        'verisimilitude','sesquipedalian','antidisestablishmentarianism',
        'obfuscate','defenestrate','confabulate','perspicacious','loquacious',
        'magniloquent','pusillanimous','tergiversate','concatenate',
        'denouement','bildungsroman','schadenfreude','onomatopoeia',
        'anthropomorphize','compartmentalize','disenfranchise','institutionalize',
        'prestidigitation','prognosticate','psychoanalysis','socioeconomic',
        'transubstantiation','counterintuitive','multidisciplinary',
        'neuroplasticity','thermodynamics','electromagnetism',
        'phenomenological','epistemological','existentialism','postmodernism',
        'decontextualize','reconceptualize','interdisciplinary',
        'psychopharmacology','neurodegenerative','biogeochemical'
    ]);

    function getWordLevel(word) {
        const w = word.toLowerCase().replace(/[^a-z]/g, '');
        if (!w) return LanguageLevel.ROOKIE;
        if (c1Words.has(w)) return LanguageLevel.SAGE;
        if (b2Words.has(w)) return LanguageLevel.MASTER;
        if (b1Words.has(w)) return LanguageLevel.WEAVER;
        if (a2Words.has(w)) return LanguageLevel.CRAFTER;
        if (a1Words.has(w)) return LanguageLevel.ROOKIE;

        // Dictionary lookup (preferred)
        if (cefrMap && cefrMap.size > 0) {
            if (cefrMap.has(w)) return codeToLevel(cefrMap.get(w));
            // Known-dictionary-but-not-in-it → treat as Rookie (matches Android).
            // This prevents misspellings like "hamste" or "allwoing" from
            // getting promoted by length-based heuristics.
            return LanguageLevel.ROOKIE;
        }

        // Dictionary not loaded yet: fall back to length heuristic so the
        // app still works on first-load fast games / offline.
        if (w.length >= 12) return LanguageLevel.MASTER;
        if (w.length >= 9) return LanguageLevel.WEAVER;
        if (w.length >= 7) return LanguageLevel.CRAFTER;
        return LanguageLevel.EXPLORER;
    }

    function isKnownWord(word) {
        const w = word.toLowerCase().replace(/[^a-z]/g, '');
        if (!w) return false;
        if (a1Words.has(w) || a2Words.has(w) || b1Words.has(w) ||
            b2Words.has(w) || c1Words.has(w)) return true;
        return !!(cefrMap && cefrMap.has(w));
    }

    function levelToScore(level) { return level.score; }

    function levelFromScore(score) {
        if (score >= 5.5) return LanguageLevel.SAGE;
        if (score >= 4.5) return LanguageLevel.MASTER;
        if (score >= 3.5) return LanguageLevel.WEAVER;
        if (score >= 2.5) return LanguageLevel.CRAFTER;
        if (score >= 1.5) return LanguageLevel.EXPLORER;
        return LanguageLevel.ROOKIE;
    }

    function calculateAverageLevel(words) {
        if (words.length === 0) return LanguageLevel.ROOKIE;
        const avg = words.reduce((sum, w) => sum + getWordLevel(w).score, 0) / words.length;
        return levelFromScore(avg);
    }

    function getDominantLevel(words) {
        const counts = {};
        words.forEach(w => {
            const lvl = getWordLevel(w).code;
            counts[lvl] = (counts[lvl] || 0) + 1;
        });
        let best = 'A1', bestCount = 0;
        Object.entries(counts).forEach(([code, count]) => {
            if (count > bestCount) { best = code; bestCount = count; }
        });
        return best;
    }

    function getBestWord(words) {
        // Prefer dictionary-confirmed words so "hamste"/"allwoing" can't win.
        // If the whole player's submission has no confirmed words, fall back
        // to the raw list so we still return *something*.
        const known = words.filter(w => isKnownWord(w));
        const candidates = known.length > 0 ? known : words;
        let best = '', bestScore = 0;
        candidates.forEach(w => {
            const clean = w.replace(/[^a-z]/gi, '');
            const score = getWordLevel(clean).score;
            if (score > bestScore || (score === bestScore && clean.length > best.length)) {
                best = clean; bestScore = score;
            }
        });
        return best || (candidates[0] || '').replace(/[^a-z]/gi, '');
    }

    function getLevelBreakdown(words) {
        const breakdown = {};
        words.forEach(w => {
            const lvl = getWordLevel(w);
            const key = lvl.code + ' ' + lvl.label;
            breakdown[key] = (breakdown[key] || 0) + 1;
        });
        return breakdown;
    }

    function getRarityMultiplier(word) {
        return getWordLevel(word).multiplier;
    }

    return {
        LanguageLevel, getWordLevel, levelToScore, levelFromScore,
        calculateAverageLevel, getDominantLevel, getBestWord,
        getLevelBreakdown, getRarityMultiplier, isKnownWord, load
    };
})();


// ─── CHUNK 2: Word Classification ─────────────────────────────────────────────
// Port of StoryAnalyzer.kt word classification (~200 lines when complete)
// Dependencies: None
const WordClassifier = (() => {
    const WordType = {
        NOUN: 'noun', VERB: 'verb', ADJECTIVE: 'adjective',
        ADVERB: 'adverb', PRONOUN: 'pronoun', PREPOSITION: 'preposition',
        CONJUNCTION: 'conjunction', DETERMINER: 'determiner',
        INTERJECTION: 'interjection', UNKNOWN: 'unknown'
    };

    // TODO: Fill from StoryAnalyzer.kt hardcoded sets
    const pronouns = new Set([
        'i','me','my','mine','myself','you','your','yours','yourself','yourselves',
        'he','him','his','himself','she','her','hers','herself',
        'it','its','itself','we','us','our','ours','ourselves',
        'they','them','their','theirs','themselves','who','whom','whose'
    ]);

    const prepositions = new Set([
        'in','on','at','to','for','with','from','by','of','about','into',
        'through','during','before','after','above','below','between','under',
        'along','across','behind','beyond','near','around','among','within',
        'without','upon','toward','towards','against','except','until','since',
        'beside','besides','beneath','despite','throughout','underneath',
        'outside','inside','onto'
    ]);

    const conjunctions = new Set([
        'and','but','or','nor','for','yet','so','because','although','though',
        'while','whereas','unless','since','until','after','before','if',
        'when','whenever','wherever','whether','however','therefore'
    ]);

    const determiners = new Set([
        'the','a','an','this','that','these','those','my','your','his','her',
        'its','our','their','some','any','no','every','each','all','both',
        'few','several','many','much'
    ]);

    const commonVerbs = new Set([
        'is','am','are','was','were','be','been','being','have','has','had',
        'do','does','did','will','would','shall','should','may','might',
        'can','could','must','go','goes','went','gone','going','come','came',
        'coming','get','got','getting','make','made','making','take','took',
        'taken','taking','see','saw','seen','seeing','know','knew','known',
        'knowing','think','thought','thinking','say','said','saying',
        'give','gave','given','giving','find','found','finding','tell','told',
        'telling','ask','asked','asking','use','used','using','try','tried',
        'trying','leave','left','leaving','call','called','calling',
        'keep','kept','keeping','let','begin','began','begun','beginning',
        'seem','seemed','seeming','help','helped','helping','show','showed',
        'shown','showing','hear','heard','hearing','play','played','playing',
        'run','ran','running','move','moved','moving','live','lived','living',
        'believe','believed','believing','bring','brought','bringing',
        'happen','happened','happening','write','wrote','written','writing',
        'sit','sat','sitting','stand','stood','standing','lose','lost',
        'pay','paid','read','grow','grew','grown','open','opened',
        'walk','walked','win','won','teach','taught','offer','offered',
        'remember','remembered','love','loved','consider','considered',
        'appear','appeared','buy','bought','wait','waited','serve','served',
        'die','died','send','sent','expect','expected','build','built',
        'stay','stayed','fall','fell','cut','reach','reached','kill','killed',
        'remain','remained','suggest','suggested','raise','raised','pass','passed'
    ]);

    const commonAdjectives = new Set([
        'good','great','big','small','old','young','new','long','little','high',
        'large','important','different','next','early','last','certain','sure',
        'free','better','best','right','left','whole','real','clear','recent',
        'possible','special','hard','full','bad','strong','true','various',
        'dark','cold','hot','deep','fast','slow','wide','heavy','ready',
        'simple','easy','difficult','short','open','red','blue','green',
        'white','black','beautiful','happy','sad','angry','afraid','alone',
        'alive','dead','rich','poor','safe','dangerous','strange','wonderful',
        'terrible','perfect','quiet','loud','bright','tiny','huge','ancient',
        'modern','brave','gentle','fierce','wild','calm','rough','smooth'
    ]);

    const commonAdverbs = new Set([
        'very','really','quite','just','also','too','still','already','always',
        'never','often','sometimes','usually','now','then','here','there',
        'where','when','how','why','not','only','even','almost','about',
        'well','quickly','slowly','suddenly','carefully','easily','finally',
        'simply','actually','probably','certainly','perhaps','maybe',
        'immediately','quietly','loudly','gently','completely','deeply'
    ]);

    const interjections = new Set([
        'oh','ah','wow','hey','ouch','oops','yay','ugh','hmm','huh',
        'alas','hurray','hooray','bravo','yikes','gosh','jeez','phew',
        'whoa','dang','darn','sheesh','boom','bam','crash','splash',
        'bang','pop','whoosh','zip','zap','kaboom'
    ]);

    const commonNouns = new Set([
        'time','year','people','way','day','man','woman','child','world','life',
        'hand','part','place','case','week','company','system','program','question',
        'work','government','number','night','point','home','water','room',
        'mother','area','money','story','fact','month','lot','right','study',
        'book','eye','job','word','business','issue','side','kind','head',
        'house','service','friend','father','power','hour','game','line',
        'end','member','law','car','city','community','name','president',
        'team','minute','idea','body','information','back','parent','face',
        'thing','door','morning','reason','research','girl','guy','moment',
        'air','teacher','force','education','dog','cat','tree','sun','moon',
        'star','king','queen','sword','dragon','magic','fire','stone','river'
    ]);

    function classifyWord(word) {
        const lower = word.toLowerCase().replace(/[^a-z']/g, '');
        if (!lower) return { word: lower, type: WordType.UNKNOWN };

        if (interjections.has(lower)) return { word: lower, type: WordType.INTERJECTION };
        if (pronouns.has(lower)) return { word: lower, type: WordType.PRONOUN };
        if (determiners.has(lower)) return { word: lower, type: WordType.DETERMINER };
        if (prepositions.has(lower)) return { word: lower, type: WordType.PREPOSITION };
        if (conjunctions.has(lower)) return { word: lower, type: WordType.CONJUNCTION };
        if (commonVerbs.has(lower)) return { word: lower, type: WordType.VERB };
        if (commonAdjectives.has(lower)) return { word: lower, type: WordType.ADJECTIVE };
        if (commonAdverbs.has(lower)) return { word: lower, type: WordType.ADVERB };
        if (commonNouns.has(lower)) return { word: lower, type: WordType.NOUN };

        // Suffix heuristics
        if (lower.endsWith('ly') && lower.length > 4) return { word: lower, type: WordType.ADVERB };
        if (lower.endsWith('ing')) return { word: lower, type: WordType.VERB };
        if (lower.endsWith('ed') && lower.length > 4) return { word: lower, type: WordType.VERB };
        if (lower.endsWith('tion') || lower.endsWith('sion') || lower.endsWith('ment') ||
            lower.endsWith('ness') || lower.endsWith('ity') || lower.endsWith('ance') ||
            lower.endsWith('ence')) return { word: lower, type: WordType.NOUN };
        if (lower.endsWith('ful') || lower.endsWith('ous') || lower.endsWith('ive') ||
            lower.endsWith('able') || lower.endsWith('ible') || lower.endsWith('ish') ||
            lower.endsWith('al') || lower.endsWith('ical')) return { word: lower, type: WordType.ADJECTIVE };

        // Default: noun
        return { word: lower, type: WordType.NOUN };
    }

    return { WordType, classifyWord };
})();


// ─── CHUNK 3: Scoring Functions ───────────────────────────────────────────────
// Port of StoryAnalyzer.kt scoring functions (~150 lines when complete)
// Dependencies: Chunk 2 (classifyWord output format: {word, type})
const ScoringEngine = (() => {
    const WT = WordClassifier.WordType;

    function scoreCoherence(analyses) {
        let score = 50;
        const types = analyses.map(a => a.type);
        const hasNouns = types.includes(WT.NOUN);
        const hasVerbs = types.includes(WT.VERB);
        if (hasNouns && hasVerbs) score += 15;

        // Reward good patterns: DET+NOUN, ADJ+NOUN, NOUN+VERB
        for (let i = 0; i < types.length - 1; i++) {
            if (types[i] === WT.DETERMINER && (types[i+1] === WT.NOUN || types[i+1] === WT.ADJECTIVE)) score += 3;
            if (types[i] === WT.ADJECTIVE && types[i+1] === WT.NOUN) score += 3;
            if (types[i] === WT.NOUN && types[i+1] === WT.VERB) score += 2;
        }

        // Penalize same type 3+ in a row
        for (let i = 0; i < types.length - 2; i++) {
            if (types[i] === types[i+1] && types[i+1] === types[i+2] &&
                types[i] !== WT.NOUN && types[i] !== WT.UNKNOWN) {
                score -= 5;
            }
        }

        return Math.max(0, Math.min(100, score));
    }

    function scoreCreativity(analyses) {
        if (analyses.length === 0) return 40;
        let score = 40;
        const words = analyses.map(a => a.word);
        const unique = new Set(words);
        score += Math.round((unique.size / words.length) * 30);

        // Descriptive words bonus
        const descriptive = analyses.filter(a => a.type === WT.ADJECTIVE || a.type === WT.ADVERB).length;
        score += Math.round((descriptive / analyses.length) * 20);

        // Long words bonus
        const avgLen = words.reduce((s, w) => s + w.length, 0) / words.length;
        if (avgLen > 5) score += 10;
        if (avgLen > 7) score += 5;

        return Math.max(0, Math.min(100, score));
    }

    const funnyWords = new Set([
        'banana','exploded','unicorn','ninja','pants','penguin','zombie','pirate',
        'suddenly','accidentally','unfortunately','magical','ridiculous','absurd',
        'chaos','disaster','oops','whoops','boom','crash','splat','bonkers',
        'wacky','bizarre','shenanigans','hullabaloo','kerfuffle','brouhaha',
        'pickle','noodle','wiggle'
    ]);

    function scoreHumor(analyses, storyText) {
        let score = 20;
        const words = analyses.map(a => a.word);

        // Funny word matches
        words.forEach(w => {
            if (funnyWords.has(w)) score += 8;
        });

        // Interjection bonus
        const interjections = analyses.filter(a => a.type === WT.INTERJECTION).length;
        score += interjections * 5;

        // Exclamation marks
        const exclamations = (storyText.match(/!/g) || []).length;
        score += exclamations * 3;

        return Math.max(0, Math.min(100, score));
    }

    function scoreVocabulary(analyses) {
        if (analyses.length === 0) return 30;
        let score = 30;
        const words = analyses.map(a => a.word);
        const unique = new Set(words);

        // Unique word ratio
        score += Math.round((unique.size / words.length) * 35);

        // Long words bonus (7+ chars)
        const longWords = words.filter(w => w.length >= 7).length;
        score += Math.min(15, longWords * 3);

        // Word type variety
        const typeSet = new Set(analyses.map(a => a.type));
        score += Math.min(15, typeSet.size * 3);

        // Filler penalty
        const fillers = new Set(['um','uh','like','just','very','really','basically','literally']);
        const fillerCount = words.filter(w => fillers.has(w)).length;
        if (fillerCount / words.length > 0.3) score -= 10;

        return Math.max(0, Math.min(100, score));
    }

    function scoreFlow(analyses) {
        if (analyses.length === 0) return 40;
        let score = 40;
        const types = analyses.map(a => a.type);

        // Good patterns: DET ADJ NOUN VERB
        for (let i = 0; i < types.length - 3; i++) {
            if (types[i] === WT.DETERMINER && types[i+1] === WT.ADJECTIVE &&
                types[i+2] === WT.NOUN && types[i+3] === WT.VERB) {
                score += 8;
            }
        }

        // Adverb before adjective
        for (let i = 0; i < types.length - 1; i++) {
            if (types[i] === WT.ADVERB && types[i+1] === WT.ADJECTIVE) score += 4;
        }

        // Proper verb usage after pronouns/nouns
        for (let i = 0; i < types.length - 1; i++) {
            if ((types[i] === WT.PRONOUN || types[i] === WT.NOUN) && types[i+1] === WT.VERB) score += 3;
        }

        // Penalize double prepositions
        for (let i = 0; i < types.length - 1; i++) {
            if (types[i] === WT.PREPOSITION && types[i+1] === WT.PREPOSITION) score -= 3;
        }

        return Math.max(0, Math.min(100, score));
    }

    return { scoreCoherence, scoreCreativity, scoreHumor, scoreVocabulary, scoreFlow };
})();


// ─── CHUNK 4: Detection & Generation ──────────────────────────────────────────
// Port of StoryAnalyzer.kt detection functions (~120 lines when complete)
// Dependencies: Chunk 2 (classifyWord output format)
const StoryDetector = (() => {
    function calculateGrade(coherence, creativity, humor, vocabulary, flow) {
        const avg = Math.round(coherence * 0.25 + creativity * 0.25 + humor * 0.15 + vocabulary * 0.20 + flow * 0.15);
        if (avg >= 93) return 'A+';
        if (avg >= 87) return 'A';
        if (avg >= 83) return 'A-';
        if (avg >= 78) return 'B+';
        if (avg >= 73) return 'B';
        if (avg >= 68) return 'B-';
        if (avg >= 63) return 'C+';
        if (avg >= 58) return 'C';
        if (avg >= 53) return 'C-';
        if (avg >= 48) return 'D+';
        if (avg >= 43) return 'D';
        return 'F';
    }

    const genreKeywords = {
        'Fantasy':    ['dragon','wizard','magic','sword','kingdom','spell','fairy','elf','quest','enchanted'],
        'Sci-Fi':     ['space','robot','alien','laser','galaxy','planet','spaceship','future','android','cyber'],
        'Horror':     ['dark','ghost','scream','blood','fear','shadow','monster','haunted','death','nightmare'],
        'Romance':    ['love','heart','kiss','beautiful','passion','romance','together','forever','gentle','embrace'],
        'Comedy':     ['funny','laugh','joke','silly','ridiculous','absurd','hilarious','oops','clown','prank'],
        'Adventure':  ['journey','treasure','explore','discover','brave','danger','quest','travel','wild','expedition'],
        'Mystery':    ['detective','clue','secret','mystery','hidden','suspect','crime','evidence','solve','witness'],
        'Drama':      ['betrayal','conflict','struggle','emotion','tears','family','truth','sacrifice','courage','loss'],
        'Action':     ['fight','battle','explosion','chase','weapon','attack','defend','warrior','hero','combat'],
        'Slice of Life': ['morning','coffee','friend','walk','home','school','work','day','simple','normal']
    };

    function detectGenre(analyses) {
        const words = new Set(analyses.map(a => a.word));
        let bestGenre = 'Slice of Life';
        let bestCount = 0;
        Object.entries(genreKeywords).forEach(([genre, keywords]) => {
            const count = keywords.filter(k => words.has(k)).length;
            if (count > bestCount) { bestGenre = genre; bestCount = count; }
        });
        return bestGenre;
    }

    const moodKeywords = {
        'Happy':      ['happy','joy','laugh','wonderful','great','amazing','beautiful','love','sunshine','celebrate'],
        'Sad':        ['sad','cry','tears','loss','alone','grief','sorrow','lonely','miss','goodbye'],
        'Tense':      ['danger','fear','chase','escape','hide','scream','panic','rush','trap','threat'],
        'Mysterious': ['secret','hidden','strange','unknown','shadow','whisper','clue','puzzle','dark','fog'],
        'Romantic':   ['love','heart','kiss','together','passion','tender','embrace','sweet','warm','gentle'],
        'Humorous':   ['funny','silly','ridiculous','oops','accidentally','chaos','hilarious','absurd','wacky','bonkers'],
        'Dark':       ['death','blood','nightmare','horror','evil','demon','curse','doom','grave','sinister'],
        'Neutral':    ['said','went','the','was','had','then','next','after','there','here']
    };

    function detectMood(analyses) {
        const words = new Set(analyses.map(a => a.word));
        let bestMood = 'Neutral';
        let bestCount = 0;
        Object.entries(moodKeywords).forEach(([mood, keywords]) => {
            const count = keywords.filter(k => words.has(k)).length;
            if (count > bestCount) { bestMood = mood; bestCount = count; }
        });
        return bestMood;
    }

    function generateTags(analyses, genre, mood, scores) {
        const tags = [genre];
        if (mood !== 'Neutral') tags.push(mood);
        if (scores.vocabulary > 70) tags.push('Rich Vocabulary');
        if (scores.humor > 70) tags.push('Hilarious');
        if (scores.coherence > 80) tags.push('Well-Structured');
        if (analyses.length > 50) tags.push('Epic');
        else if (analyses.length < 15) tags.push('Short & Sweet');
        return tags.slice(0, 5);
    }

    const wordEmojis = {
        'dragon': '\u{1F409}', 'fire': '\u{1F525}', 'magic': '\u2728', 'sword': '\u2694\uFE0F',
        'love': '\u2764\uFE0F', 'heart': '\u{1F496}', 'star': '\u2B50', 'moon': '\u{1F319}',
        'sun': '\u2600\uFE0F', 'tree': '\u{1F333}', 'flower': '\u{1F33A}', 'ocean': '\u{1F30A}',
        'space': '\u{1F680}', 'robot': '\u{1F916}', 'ghost': '\u{1F47B}', 'king': '\u{1F451}',
        'queen': '\u{1F478}', 'dog': '\u{1F436}', 'cat': '\u{1F431}', 'bird': '\u{1F426}',
        'fish': '\u{1F41F}', 'mountain': '\u26F0\uFE0F', 'rain': '\u{1F327}\uFE0F',
        'snow': '\u2744\uFE0F', 'music': '\u{1F3B5}', 'book': '\u{1F4D6}', 'treasure': '\u{1F4B0}',
        'castle': '\u{1F3F0}', 'ship': '\u26F5', 'diamond': '\u{1F48E}', 'crown': '\u{1F451}',
        'key': '\u{1F511}', 'door': '\u{1F6AA}', 'clock': '\u{1F570}\uFE0F', 'skull': '\u{1F480}'
    };

    function generateIllustration(analyses) {
        const words = analyses.map(a => a.word);
        const emojis = [];
        for (const w of words) {
            if (wordEmojis[w] && !emojis.includes(wordEmojis[w])) {
                emojis.push(wordEmojis[w]);
                if (emojis.length >= 3) break;
            }
        }
        return emojis.length > 0 ? emojis.join('') : '\u{1F4D6}';
    }

    function generateFeedback(grade, genre, mood, scores) {
        let feedback = '';
        if (grade.startsWith('A')) feedback = 'Outstanding story! ';
        else if (grade.startsWith('B')) feedback = 'Great collaborative effort! ';
        else if (grade.startsWith('C')) feedback = 'Nice work! ';
        else feedback = 'Keep practicing! ';

        // Highlight strongest area
        const scoreMap = { Coherence: scores.coherence, Creativity: scores.creativity,
            Humor: scores.humor, Vocabulary: scores.vocabulary, Flow: scores.flow };
        const best = Object.entries(scoreMap).sort((a, b) => b[1] - a[1])[0];
        feedback += best[0] + ' was your strongest area. ';

        // Suggest improvement for weakest
        const worst = Object.entries(scoreMap).sort((a, b) => a[1] - b[1])[0];
        if (worst[1] < 60) feedback += 'Try to improve ' + worst[0].toLowerCase() + ' next time!';

        return feedback;
    }

    return { calculateGrade, detectGenre, detectMood, generateTags, generateIllustration, generateFeedback };
})();


// ─── CHUNK 5: Player Stats & Main Entry ───────────────────────────────────────
// Port of StoryAnalyzer.kt orchestration (~150 lines when complete)
// Dependencies: All previous chunks
const StoryAnalyzer = (() => {

    const titleMap = [
        { check: (d) => (d.verb || 0) > (d.noun || 0) * 1.5, title: 'The Director', desc: 'Drives the action forward' },
        { check: (d) => (d.adjective || 0) > (d.noun || 0), title: 'The Painter', desc: 'Colors every scene' },
        { check: (d) => (d.adverb || 0) > 3, title: 'The Poet', desc: 'Adds rhythm and flow' },
        { check: (d) => (d.noun || 0) > (d.verb || 0) * 1.5, title: 'The World Builder', desc: 'Creates rich settings' },
        { check: (d) => (d.interjection || 0) >= 2, title: 'The Comedian', desc: 'Keeps everyone laughing' },
        { check: (d) => (d.conjunction || 0) > 3, title: 'The Connector', desc: 'Ties ideas together' },
        { check: (d) => (d.pronoun || 0) > (d.noun || 0), title: 'The Character Writer', desc: 'Focuses on people' },
        { check: (d) => (d.preposition || 0) > 4, title: 'The Navigator', desc: 'Guides the journey' },
        { check: (d) => {
            const total = Object.values(d).reduce((s, v) => s + v, 0);
            const types = Object.values(d).filter(v => v > 0).length;
            return types >= 5 && total > 5;
        }, title: 'The Storyteller', desc: 'A well-rounded writer' },
    ];

    function generatePlayerTitle(distribution) {
        for (const t of titleMap) {
            if (t.check(distribution)) return { title: t.title, desc: t.desc };
        }
        return { title: 'The Wordsmith', desc: 'Crafts words with care' };
    }

    function buildPlayerStats(player, playerWords, allWords, allAnalyses) {
        const wordTexts = playerWords.map(w => w.word);
        const analyses = wordTexts.map(w => WordClassifier.classifyWord(w));
        const unique = new Set(wordTexts.map(w => w.toLowerCase().replace(/[^a-z]/g, '')));
        const avgLen = wordTexts.length > 0
            ? (wordTexts.reduce((s, w) => s + w.replace(/[^a-z]/gi, '').length, 0) / wordTexts.length).toFixed(1)
            : 0;
        // Prefer the longest dictionary-confirmed word so misspellings like
        // "allwoing" can't win. Fall back to raw longest only if no player
        // word passes validation.
        const knownTexts = wordTexts.filter(w => WordRarity.isKnownWord(w));
        const lengthPool = knownTexts.length > 0 ? knownTexts : wordTexts;
        const longestWord = lengthPool.reduce((best, w) => {
            const clean = w.replace(/[^a-z]/gi, '');
            return clean.length > best.length ? clean : best;
        }, '');

        // Word type distribution
        const dist = {};
        analyses.forEach(a => { dist[a.type] = (dist[a.type] || 0) + 1; });

        // Language level
        const level = WordRarity.calculateAverageLevel(wordTexts);
        const bestWord = WordRarity.getBestWord(wordTexts);
        const levelBreakdown = WordRarity.getLevelBreakdown(wordTexts);

        // Impact score: weighted combination of contribution + uniqueness + rarity
        const contribution = allWords.length > 0 ? wordTexts.length / allWords.length : 0;
        const uniqueRatio = wordTexts.length > 0 ? unique.size / wordTexts.length : 0;
        const rarityBonus = wordTexts.reduce((s, w) => s + WordRarity.getRarityMultiplier(w), 0) / Math.max(1, wordTexts.length);
        const impactScore = Math.min(100, Math.round(
            contribution * 40 + uniqueRatio * 30 + rarityBonus * 15 + Math.min(15, wordTexts.length * 0.5)
        ));

        const titleInfo = generatePlayerTitle(dist);

        return {
            playerName: player.name,
            playerAvatar: player.avatar || '\u{1F60A}',
            wordCount: wordTexts.length,
            uniqueWords: unique.size,
            avgWordLength: parseFloat(avgLen),
            longestWord: longestWord,
            impactScore: impactScore,
            languageLevel: level.code,
            languageLevelName: level.label,
            bestWord: bestWord,
            title: titleInfo.title,
            titleDescription: titleInfo.desc,
            wordTypeDistribution: dist,
            levelBreakdown: levelBreakdown
        };
    }

    function buildStoryText(wordsArray) {
        let text = '';
        const storyWords = wordsArray.map(w => w.word);
        storyWords.forEach((w, i) => {
            if (i === 0 || (i > 0 && /[.!?]$/.test(storyWords[i - 1]))) {
                w = w.charAt(0).toUpperCase() + w.slice(1);
            }
            text += (i > 0 ? ' ' : '') + w;
        });
        if (text && !/[.!?]$/.test(text)) text += '.';
        return text;
    }

    function analyze(fullStory, words, players) {
        // 1. Classify all non-starter words
        const storyWords = words.filter(w => w.playerId !== -1);
        const allWords = storyWords.map(w => w.word);
        const analyses = allWords.map(w => WordClassifier.classifyWord(w));

        // 2. Score each dimension
        const coherence = ScoringEngine.scoreCoherence(analyses);
        const creativity = ScoringEngine.scoreCreativity(analyses);
        const humor = ScoringEngine.scoreHumor(analyses, fullStory);
        const vocabulary = ScoringEngine.scoreVocabulary(analyses);
        const flow = ScoringEngine.scoreFlow(analyses);

        // 3. Calculate grade
        const storyGrade = StoryDetector.calculateGrade(coherence, creativity, humor, vocabulary, flow);

        // 4. Detect genre and mood
        const genreDetected = StoryDetector.detectGenre(analyses);
        const moodDetected = StoryDetector.detectMood(analyses);

        // 5. Generate extras
        const tags = StoryDetector.generateTags(analyses, genreDetected, moodDetected,
            { coherence, creativity, humor, vocabulary, flow });
        const illustration = StoryDetector.generateIllustration(analyses);
        const feedback = StoryDetector.generateFeedback(storyGrade, genreDetected, moodDetected,
            { coherence, creativity, humor, vocabulary, flow });

        // 6. Build per-player stats
        const playerStats = players.map(p => {
            const playerWords = words.filter(w => w.playerId === p.id);
            return buildPlayerStats(p, playerWords, allWords, analyses);
        });

        // 7. Return result object matching what game.js expects
        return {
            fullStory,
            storyGrade,
            genreDetected,
            moodDetected,
            coherenceScore: coherence,
            creativityScore: creativity,
            humorScore: humor,
            vocabularyScore: vocabulary,
            flowScore: flow,
            playerStats,
            totalWords: allWords.length,
            tags,
            illustration,
            feedback
        };
    }

    return { analyze };
})();
