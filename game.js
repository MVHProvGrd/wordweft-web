// Game logic module for WordWeft web client
const Game = (() => {
    let players = [];
    let words = [];
    let currentPlayerIndex = 0;
    let turnWordCount = 0;
    let turnWordsNeeded = 1;
    let gameMode = 'ONE_WORD';
    let turnTimerSeconds = 0;
    let timerInterval = null;
    let timerRemaining = 0;
    let hasVotedToFinish = false;
    let finishVoteCount = 0;

    // Player color hex values for display
    const COLOR_MAP = {
        [0xFFFF6B6B]: '#FF6B6B',
        [0xFF4ECDC4]: '#4ECDC4',
        [0xFF45B7D1]: '#45B7D1',
        [0xFF96CEB4]: '#96CEB4',
        [0xFFFFEAA7]: '#FFEAA7',
        [0xFFDDA0DD]: '#DDA0DD',
        [0xFF98D8C8]: '#98D8C8',
        [0xFFF7DC6F]: '#F7DC6F'
    };

    function getPlayerColor(colorValue) {
        return COLOR_MAP[colorValue] || '#A0A0B8';
    }

    function startListening() {
        // Players
        Room.listen('players', (snap) => {
            const data = snap.val();
            if (!data) return;
            players = [];
            Object.keys(data).sort((a, b) => parseInt(a) - parseInt(b)).forEach((key) => {
                const p = data[key];
                players.push({
                    id: parseInt(key),
                    name: p.name,
                    color: p.color,
                    avatar: p.avatar || '',
                    isAI: p.isAI || false,
                    isHost: p.isHost || false,
                    uid: p.uid
                });
            });
            updatePlayerList();
            updateLobbyPlayers();
        });

        // Words
        Room.listen('words', (snap) => {
            const data = snap.val();
            const oldLength = words.length;
            words = [];
            if (data) {
                Object.keys(data).sort((a, b) => parseInt(a) - parseInt(b)).forEach((key) => {
                    const w = data[key];
                    words.push({
                        word: w.word,
                        playerId: w.playerId,
                        position: w.position
                    });
                });
            }
            renderStory(oldLength);
        });

        // Turn state
        Room.listen('turn', (snap) => {
            const data = snap.val();
            if (!data) return;
            const oldIndex = currentPlayerIndex;
            currentPlayerIndex = data.currentPlayerIndex || 0;
            turnWordCount = data.turnWordCount || 0;
            turnWordsNeeded = data.turnWordsNeeded || 1;
            updateTurnIndicator();
            updateInputState();

            // Reset timer on turn change
            if (oldIndex !== currentPlayerIndex) {
                if (typeof Sound !== 'undefined') Sound.playTurnChange();
                if (turnTimerSeconds > 0) startTimer();
            }
        });

        // Game started
        Room.listen('meta/isStarted', (snap) => {
            if (snap.val() === true) {
                App.showScreen('game');
            }
        });

        // Game mode
        Room.listen('meta/gameMode', (snap) => {
            gameMode = snap.val() || 'ONE_WORD';
            const modeLabel = document.getElementById('game-mode-label');
            const labels = {
                'ONE_WORD': '1 Word',
                'THREE_WORDS': '3 Words',
                'FIVE_WORDS': '5 Words',
                'SENTENCE': 'Sentence',
                'CUSTOM': 'Custom'
            };
            if (modeLabel) modeLabel.textContent = labels[gameMode] || gameMode;
        });

        // Timer
        Room.listen('meta/turnTimerSeconds', (snap) => {
            turnTimerSeconds = snap.val() || 0;
        });

        // Finish votes
        Room.listen('votes/finish', (snap) => {
            finishVoteCount = snap.numChildren();
            const voteEl = document.getElementById('vote-count');
            const humanCount = players.filter(p => !p.isAI).length;
            if (voteEl) {
                voteEl.textContent = finishVoteCount > 0 ? '(' + finishVoteCount + '/' + humanCount + ')' : '';
            }
            // Check if all human players voted to finish
            if (finishVoteCount >= humanCount && humanCount > 0 && Room.isHost) {
                finishGame();
            }
        });

        // Typing indicators
        Room.listen('typing', (snap) => {
            const data = snap.val();
            const indicator = document.getElementById('typing-indicator');
            const nameEl = document.getElementById('typing-name');
            if (!data || Object.keys(data).length === 0) {
                indicator.classList.add('hidden');
                return;
            }
            const typingIds = Object.keys(data).map(Number).filter(id => id !== Room.myIndex);
            if (typingIds.length === 0) {
                indicator.classList.add('hidden');
                return;
            }
            const typingNames = typingIds.map(id => {
                const p = players.find(pl => pl.id === id);
                return p ? p.name : '?';
            });
            indicator.classList.remove('hidden');
            nameEl.textContent = typingNames.join(', ') + ' typing...';
        });

        // Hidden objectives
        Room.listen('objectives', (snap) => {
            const data = snap.val();
            const area = document.getElementById('secret-word-area');
            const wordEl = document.getElementById('secret-word');
            if (!data) {
                area.classList.add('hidden');
                return;
            }
            // Find my objective
            const myObj = data[Room.myIndex];
            if (myObj && myObj.secretWord) {
                area.classList.remove('hidden');
                wordEl.textContent = myObj.secretWord;
                if (myObj.completed) {
                    wordEl.style.textDecoration = 'line-through';
                    wordEl.style.opacity = '0.5';
                }
            }
        });

        // Result
        Room.listen('result', (snap) => {
            const data = snap.val();
            if (!data) return;
            showResults(data);
        });
    }

    function updateLobbyPlayers() {
        const list = document.getElementById('player-list');
        const count = document.getElementById('player-count');
        if (!list) return;

        list.innerHTML = '';
        players.forEach(p => {
            const item = document.createElement('div');
            item.className = 'player-item';
            item.innerHTML = `
                <span class="player-item-avatar">${p.avatar || '\u{1F60A}'}</span>
                <span class="player-item-name" style="color: ${getPlayerColor(p.color)}">${p.name}</span>
                ${p.isHost ? '<span class="player-item-host">Host</span>' : ''}
                ${p.isAI ? '<span class="player-item-host" style="color:#F59E0B;background:rgba(245,158,11,0.15)">AI</span>' : ''}
            `;
            list.appendChild(item);
        });
        if (count) count.textContent = '(' + players.length + '/8)';

        // Enable start button for host with 2+ players
        const startBtn = document.getElementById('btn-start-game');
        if (startBtn) {
            startBtn.disabled = players.length < 2;
        }
    }

    function updatePlayerList() {
        // Update for game screen if needed
    }

    function renderStory(oldLength) {
        const textEl = document.getElementById('story-text');
        if (!textEl) return;

        if (words.length === 0) {
            textEl.innerHTML = '<span class="story-placeholder">The story begins when someone submits a word...</span>';
            return;
        }

        textEl.innerHTML = '';
        words.forEach((w, i) => {
            const span = document.createElement('span');
            span.className = 'story-word';
            const player = players.find(p => p.id === w.playerId);
            if (player) {
                span.style.color = getPlayerColor(player.color);
            } else if (w.playerId === -1) {
                // Prompt word
                span.style.color = '#666680';
                span.style.fontStyle = 'italic';
            }
            span.textContent = (i > 0 ? ' ' : '') + w.word;
            if (i >= oldLength) {
                span.classList.add('new');
            }
            textEl.appendChild(span);
        });

        // Auto-scroll to bottom
        const storyArea = document.getElementById('story-area');
        if (storyArea) {
            storyArea.scrollTop = storyArea.scrollHeight;
        }
    }

    function updateTurnIndicator() {
        const el = document.getElementById('turn-indicator');
        if (!el) return;
        const player = players[currentPlayerIndex];
        if (!player) return;

        const isMyTurn = currentPlayerIndex === Room.myIndex;
        if (isMyTurn) {
            el.innerHTML = '<span class="current-player">Your turn!</span>';
        } else {
            el.innerHTML = '<span style="color:' + getPlayerColor(player.color) + '">' +
                (player.avatar ? player.avatar + ' ' : '') + player.name + '</span>\'s turn';
        }
    }

    function updateInputState() {
        const input = document.getElementById('word-input');
        const btn = document.getElementById('btn-submit-word');
        const isMyTurn = currentPlayerIndex === Room.myIndex;

        if (input) {
            input.disabled = !isMyTurn;
            input.placeholder = isMyTurn ? getPlaceholder() : 'Wait for your turn...';
            if (isMyTurn) input.focus();
        }
        if (btn) btn.disabled = !isMyTurn;
    }

    function getPlaceholder() {
        switch (gameMode) {
            case 'ONE_WORD': return 'Type one word...';
            case 'THREE_WORDS': return 'Type three words...';
            case 'FIVE_WORDS': return 'Type five words...';
            case 'SENTENCE': return 'Type until punctuation...';
            case 'CUSTOM': return 'Type words...';
            default: return 'Type your word...';
        }
    }

    function submitWord(text) {
        text = text.trim();
        if (!text) return;
        if (currentPlayerIndex !== Room.myIndex) return;

        const wordsToSubmit = splitWords(text);
        if (!isValidSubmission(wordsToSubmit)) return;

        // Clear typing
        Room.setTyping(Room.myIndex, false);

        // Submit words sequentially to avoid race conditions with Firebase indexes
        (async () => {
            for (const w of wordsToSubmit) {
                await Room.submitWord(w, Room.myIndex);
            }
            if (typeof Sound !== 'undefined') Sound.playWordSubmit();

            // Check hidden objective completion
            if (Room.ref) {
                try {
                    const objSnap = await Room.ref.child('objectives/' + Room.myIndex).once('value');
                    const obj = objSnap.val();
                    if (obj && obj.word && !obj.completed) {
                        const submitted = wordsToSubmit.map(w => w.toLowerCase().replace(/[^a-z]/g, ''));
                        if (submitted.includes(obj.word.toLowerCase())) {
                            await Room.ref.child('objectives/' + Room.myIndex + '/completed').set(true);
                        }
                    }
                } catch(e) {}
            }

            const newCount = turnWordCount + wordsToSubmit.length;
            const needed = getWordsNeeded();

            if (needed && newCount >= needed) {
                // Turn complete for fixed-count modes
                const nextIndex = (currentPlayerIndex + 1) % players.length;
                Room.advanceTurn(nextIndex, needed);
            } else if (gameMode === 'SENTENCE') {
                const lastWord = wordsToSubmit[wordsToSubmit.length - 1];
                if (lastWord.endsWith('.') || lastWord.endsWith('!') || lastWord.endsWith('?')) {
                    const nextIndex = (currentPlayerIndex + 1) % players.length;
                    Room.advanceTurn(nextIndex, 0);
                } else {
                    Room.updateTurnWordCount(newCount);
                }
            } else {
                Room.updateTurnWordCount(newCount);
            }
        })();

        // Clear input
        document.getElementById('word-input').value = '';
    }

    function splitWords(text) {
        const sanitized = text.replace(/[<>{}[\]\\|`~^]/g, '');
        if (gameMode === 'ONE_WORD') {
            const parts = sanitized.split(/[\s,;]+/).filter(w => w.length > 0);
            return parts.length > 0 ? [parts[0]] : [];
        }
        return sanitized.split(/\s+/).filter(w => w.length > 0);
    }

    function getWordsNeeded() {
        switch (gameMode) {
            case 'ONE_WORD': return 1;
            case 'THREE_WORDS': return 3;
            case 'FIVE_WORDS': return 5;
            default: return null;
        }
    }

    function isValidSubmission(wordList) {
        if (wordList.length === 0) return false;
        if (!wordList.some(w => /[a-zA-Z]/.test(w))) return false;
        return true;
    }

    function toggleFinishVote() {
        hasVotedToFinish = !hasVotedToFinish;
        if (hasVotedToFinish) {
            Room.voteFinish(Room.myIndex);
        } else {
            Room.unvoteFinish(Room.myIndex);
        }
        const btn = document.getElementById('btn-vote-finish');
        if (btn) {
            btn.style.background = hasVotedToFinish ? 'rgba(239,68,68,0.2)' : 'transparent';
            btn.style.color = hasVotedToFinish ? '#EF4444' : 'var(--text-secondary)';
        }
    }

    function startTimer() {
        if (timerInterval) clearInterval(timerInterval);
        if (turnTimerSeconds <= 0) {
            document.getElementById('timer-display').classList.add('hidden');
            return;
        }

        timerRemaining = turnTimerSeconds;
        const display = document.getElementById('timer-display');
        display.classList.remove('hidden');
        display.textContent = timerRemaining;

        timerInterval = setInterval(() => {
            timerRemaining--;
            display.textContent = timerRemaining;
            display.className = 'timer-display' + (timerRemaining <= 5 ? ' urgent' : '');
            if (timerRemaining === 5 && typeof Sound !== 'undefined') Sound.playTimerWarning();

            if (timerRemaining <= 0) {
                clearInterval(timerInterval);
                // Auto-advance turn if it's our turn
                if (currentPlayerIndex === Room.myIndex) {
                    const input = document.getElementById('word-input');
                    const text = input ? input.value.trim() : '';
                    if (text) {
                        submitWord(text);
                    } else {
                        // Skip turn
                        const nextIndex = (currentPlayerIndex + 1) % players.length;
                        Room.advanceTurn(nextIndex, getWordsNeeded() || 1);
                    }
                }
            }
        }, 1000);
    }

    function showResults(data) {
        if (timerInterval) clearInterval(timerInterval);
        if (typeof Sound !== 'undefined') Sound.playGameEnd();

        App.showScreen('results');

        document.getElementById('result-grade').textContent = data.storyGrade || 'C';
        document.getElementById('result-genre').textContent =
            (data.genreDetected || '') + (data.moodDetected ? ' \u2022 ' + data.moodDetected : '');
        document.getElementById('result-story-text').textContent = data.fullStory || '';

        // Score bars
        const scores = [
            { id: 'coherence', value: data.coherenceScore || 0, color: 'score-coherence' },
            { id: 'creativity', value: data.creativityScore || 0, color: 'score-creativity' },
            { id: 'humor', value: data.humorScore || 0, color: 'score-humor' },
            { id: 'vocabulary', value: data.vocabularyScore || 0, color: 'score-vocabulary' },
            { id: 'flow', value: data.flowScore || 0, color: 'score-flow' }
        ];
        scores.forEach(s => {
            const bar = document.getElementById('bar-' + s.id);
            const val = document.getElementById('score-' + s.id);
            if (bar) {
                bar.className = 'score-fill ' + s.color;
                setTimeout(() => { bar.style.width = s.value + '%'; }, 100);
            }
            if (val) val.textContent = s.value;
        });

        // Player stats
        const statsList = document.getElementById('player-stats-list');
        statsList.innerHTML = '';
        if (data.playerStats) {
            const statsArray = Array.isArray(data.playerStats) ? data.playerStats : Object.values(data.playerStats);
            statsArray.sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0));
            statsArray.forEach(ps => {
                const card = document.createElement('div');
                card.className = 'player-stat-card';
                card.innerHTML = `
                    <div class="player-stat-header">
                        <span class="player-stat-avatar">${ps.playerAvatar || '\u{1F60A}'}</span>
                        <div style="flex:1">
                            <div class="player-stat-name">${ps.playerName || ps.player?.name || '?'}</div>
                            <div class="player-stat-title">${ps.title || ''}</div>
                        </div>
                        <span class="player-stat-impact">${ps.impactScore || 0}</span>
                    </div>
                    <div class="player-stat-details">
                        <span>${ps.wordCount || 0} words</span>
                        <span>${ps.languageLevel || 'A1'} ${ps.languageLevelName || ''}</span>
                        <span>Best: ${ps.bestWord || '-'}</span>
                    </div>
                `;
                statsList.appendChild(card);
            });
        }

        // Confetti for A grades
        if ((data.storyGrade || '').startsWith('A')) {
            launchConfetti();
        }

        // Award XP and trigger achievements/history save
        awardXP(data);

        // TTS button
        const readBtn = document.getElementById('btn-read-story');
        if (readBtn) {
            readBtn.onclick = toggleTTS;
            readBtn.innerHTML = '&#128264; Read Story';
        }
    }

    // Text-to-Speech
    let ttsPlaying = false;
    function toggleTTS() {
        const btn = document.getElementById('btn-read-story');
        if (ttsPlaying) {
            window.speechSynthesis.cancel();
            ttsPlaying = false;
            if (btn) btn.innerHTML = '&#128264; Read Story';
            return;
        }
        const text = document.getElementById('result-story-text').textContent;
        if (!text || !('speechSynthesis' in window)) return;
        const utt = new SpeechSynthesisUtterance(text);
        utt.rate = 0.9;
        utt.onend = () => {
            ttsPlaying = false;
            if (btn) btn.innerHTML = '&#128264; Read Story';
        };
        window.speechSynthesis.speak(utt);
        ttsPlaying = true;
        if (btn) btn.innerHTML = '&#9209; Stop';
    }

    function finishGame() {
        if (timerInterval) clearInterval(timerInterval);

        // Build the full story from words
        const storyWords = words.map(w => w.word);
        let fullStory = '';
        storyWords.forEach((w, i) => {
            // Capitalize after sentence-ending punctuation or at start
            if (i === 0 || (i > 0 && /[.!?]$/.test(storyWords[i - 1]))) {
                w = w.charAt(0).toUpperCase() + w.slice(1);
            }
            fullStory += (i > 0 ? ' ' : '') + w;
        });
        // Ensure story ends with punctuation
        if (fullStory && !/[.!?]$/.test(fullStory)) fullStory += '.';

        // Use analyzer if available, otherwise basic scoring
        let result;
        if (typeof StoryAnalyzer !== 'undefined') {
            result = StoryAnalyzer.analyze(fullStory, words, players);
        } else {
            // Basic fallback scoring
            const uniqueWords = new Set(storyWords.map(w => w.toLowerCase().replace(/[^a-z]/g, '')));
            const uniqueRatio = storyWords.length > 0 ? uniqueWords.size / storyWords.length : 0;
            const coherence = Math.min(100, 50 + Math.round(uniqueRatio * 30) + Math.min(20, storyWords.length));
            const creativity = Math.min(100, 40 + Math.round(uniqueRatio * 40) + (storyWords.length > 20 ? 10 : 0));
            const humor = Math.min(100, 20 + Math.round(Math.random() * 30));
            const vocabulary = Math.min(100, 30 + Math.round(uniqueRatio * 40) + Math.min(15, storyWords.length / 2));
            const flow = Math.min(100, 40 + Math.min(30, storyWords.length) + Math.round(uniqueRatio * 20));
            const avg = Math.round((coherence + creativity + humor + vocabulary + flow) / 5);
            const grade = avg >= 90 ? 'A+' : avg >= 85 ? 'A' : avg >= 80 ? 'A-' :
                          avg >= 75 ? 'B+' : avg >= 70 ? 'B' : avg >= 65 ? 'B-' :
                          avg >= 60 ? 'C+' : avg >= 55 ? 'C' : avg >= 50 ? 'C-' :
                          avg >= 45 ? 'D+' : avg >= 40 ? 'D' : 'F';

            // Per-player stats
            const playerStats = players.map(p => {
                const pWords = words.filter(w => w.playerId === p.id);
                const pWordTexts = pWords.map(w => w.word);
                const pUnique = new Set(pWordTexts.map(w => w.toLowerCase().replace(/[^a-z]/g, '')));
                const avgLen = pWordTexts.length > 0 ?
                    (pWordTexts.reduce((sum, w) => sum + w.replace(/[^a-z]/gi, '').length, 0) / pWordTexts.length).toFixed(1) : 0;
                const longest = pWordTexts.reduce((l, w) => w.replace(/[^a-z]/gi, '').length > l.length ? w : l, '');
                const impact = pWordTexts.length > 0 ?
                    Math.min(100, Math.round((pWordTexts.length / storyWords.length) * 50 + (pUnique.size / Math.max(1, pWordTexts.length)) * 50)) : 0;
                return {
                    playerName: p.name,
                    playerAvatar: p.avatar || '\u{1F60A}',
                    wordCount: pWordTexts.length,
                    uniqueWords: pUnique.size,
                    avgWordLength: avgLen,
                    longestWord: longest,
                    impactScore: impact,
                    languageLevel: 'A2',
                    languageLevelName: 'Explorer',
                    bestWord: longest,
                    title: pWordTexts.length > 10 ? 'The Wordsmith' : pWordTexts.length > 5 ? 'Story Weaver' : 'The Quiet One'
                };
            });

            result = {
                fullStory: fullStory,
                storyGrade: grade,
                genreDetected: 'Slice of Life',
                moodDetected: 'Neutral',
                coherenceScore: coherence,
                creativityScore: creativity,
                humorScore: humor,
                vocabularyScore: vocabulary,
                flowScore: flow,
                playerStats: playerStats,
                totalWords: storyWords.length
            };
        }

        Room.postResult(result);
    }

    // Grade comparison helper
    const GRADE_ORDER = ['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','F'];
    function betterGrade(a, b) {
        if (!a) return b;
        if (!b) return a;
        return GRADE_ORDER.indexOf(a) <= GRADE_ORDER.indexOf(b) ? a : b;
    }

    async function awardXP(data) {
        if (!Auth.uid) return;
        const allStats = data.playerStats ?
            (Array.isArray(data.playerStats) ? data.playerStats : Object.values(data.playerStats)) : [];
        const myStats = allStats.find(ps => ps.playerName === Auth.name);
        if (!myStats) return;

        // Calculate XP matching Android formula
        let xp = 50; // base
        xp += Math.round((myStats.impactScore || 0) / 2); // impact bonus
        const grade = (data.storyGrade || '').charAt(0);
        xp += grade === 'A' ? 40 : grade === 'B' ? 25 : grade === 'C' ? 15 : 5;

        // Winner bonus (highest impact)
        const maxImpact = Math.max(...allStats.map(s => s.impactScore || 0));
        const isWinner = (myStats.impactScore || 0) === maxImpact;
        if (isWinner) xp += 30;

        // Hidden objective bonus
        try {
            if (Room.ref) {
                const objSnap = await Room.ref.child('objectives/' + Room.myIndex).once('value');
                const obj = objSnap.val();
                if (obj) {
                    if (obj.completed && !obj.busted) xp += 15;
                    else xp -= 5;
                }
            }
        } catch(e) {}

        xp = Math.max(0, xp);

        // Update Firebase stats
        try {
            const statsRef = db.ref('users/' + Auth.uid + '/stats');
            const snap = await statsRef.once('value');
            const current = snap.val() || {};
            const newStats = {
                totalXp: (current.totalXp || 0) + xp,
                gamesPlayed: (current.gamesPlayed || 0) + 1,
                gamesWon: (current.gamesWon || 0) + (isWinner ? 1 : 0),
                totalWordsWritten: (current.totalWordsWritten || 0) + (myStats.wordCount || 0),
                totalScore: (current.totalScore || 0) + (myStats.impactScore || 0),
                bestGrade: betterGrade(current.bestGrade, data.storyGrade),
                currentStreak: (current.currentStreak || 0) + 1,
                lastPlayed: firebase.database.ServerValue.TIMESTAMP
            };
            await statsRef.update(newStats);

            // Update leaderboards
            const lbEntry = { xp: newStats.totalXp, displayName: Auth.name, avatar: Auth.avatar };
            await db.ref('leaderboard/allTime/' + Auth.uid).set(lbEntry);
            await db.ref('leaderboard/weekly/' + Auth.uid).set(lbEntry);

            // Show XP earned
            const xpSection = document.getElementById('xp-earned-section');
            const xpText = document.getElementById('xp-earned-text');
            if (xpSection && xpText) {
                xpSection.classList.remove('hidden');
                xpText.textContent = '+' + xp + ' XP earned!';
            }

            // Check achievements
            if (typeof App !== 'undefined' && App.checkAchievements) {
                App.checkAchievements(data, newStats, myStats);
            }

            // Save story to history
            if (typeof App !== 'undefined' && App.saveStory) {
                App.saveStory(data);
            }
        } catch (e) {
            console.error('Failed to award XP:', e);
        }
    }

    // Achievement definitions matching Android
    const ACHIEVEMENTS = {
        first_story:       { icon: '\u{1F4DD}', name: 'First Words',       desc: 'Complete your first story' },
        ten_stories:       { icon: '\u{1F4DA}', name: 'Prolific Author',   desc: 'Complete 10 stories' },
        fifty_stories:     { icon: '\u{1F3C6}', name: 'Literary Legend',   desc: 'Complete 50 stories' },
        first_win:         { icon: '\u{1F947}', name: 'Champion',          desc: 'Win your first game' },
        five_wins:         { icon: '\u2B50',     name: 'Serial Winner',    desc: 'Win 5 games' },
        high_impact:       { icon: '\u{1F4A5}', name: 'Story Shaper',     desc: 'Score 80+ impact in a game' },
        perfect_unique:    { icon: '\u{1F9E0}', name: 'Vocabulary Master', desc: 'Use all unique words in a game' },
        long_word:         { icon: '\u{1F4D6}', name: 'Sesquipedalian',   desc: 'Use a word with 12+ letters' },
        comedy_king:       { icon: '\u{1F602}', name: 'Comedy King',      desc: 'Get a Comedy genre story' },
        horror_master:     { icon: '\u{1F47B}', name: 'Fright Night',     desc: 'Get a Horror genre story' },
        a_plus:            { icon: '\u{1F31F}', name: 'Straight A',       desc: 'Get an A+ grade' },
        poet_title:        { icon: '\u270D\uFE0F', name: 'True Poet',     desc: "Earn 'The Poet' title 3 times" },
        action_hero:       { icon: '\u{1F3AC}', name: 'Action Star',      desc: "Earn 'The Action Hero' title 3 times" },
        hundred_words:     { icon: '\u{1F4AF}', name: 'Centurion',        desc: 'Contribute 100+ total words' },
        five_hundred_words:{ icon: '\u{1F525}', name: 'Word Machine',     desc: 'Contribute 500+ total words' },
        all_genres:        { icon: '\u{1F30D}', name: 'Genre Explorer',   desc: 'Play stories in 5+ genres' }
    };

    function launchConfetti() {
        const container = document.createElement('div');
        container.className = 'confetti-container';
        document.body.appendChild(container);
        const colors = ['#FFD700','#6366F1','#10B981','#EF4444','#8B5CF6','#F59E0B','#EC4899','#06B6D4'];
        for (let i = 0; i < 30; i++) {
            const particle = document.createElement('div');
            particle.className = 'confetti-particle';
            particle.style.backgroundColor = colors[i % colors.length];
            particle.style.left = Math.random() * 100 + '%';
            particle.style.animationDelay = (Math.random() * 0.5) + 's';
            particle.style.animationDuration = (1.5 + Math.random()) + 's';
            particle.style.setProperty('--sway', (Math.random() * 60 - 30) + 'px');
            container.appendChild(particle);
        }
        setTimeout(() => container.remove(), 3500);
    }

    function cleanup() {
        if (timerInterval) clearInterval(timerInterval);
        players = [];
        words = [];
        currentPlayerIndex = 0;
        turnWordCount = 0;
        hasVotedToFinish = false;
        finishVoteCount = 0;
    }

    return {
        startListening,
        submitWord,
        toggleFinishVote,
        finishGame,
        cleanup,
        ACHIEVEMENTS,
        get players() { return players; },
        get words() { return words; },
        get currentPlayerIndex() { return currentPlayerIndex; },
        get gameMode() { return gameMode; }
    };
})();
