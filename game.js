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
    let hasVotedToExtend = false;
    let disconnectedIds = [];

    // Player color hex values for display
    const COLOR_MAP = {
        [0xFF6366F1]: '#6366F1', // Indigo
        [0xFFEC4899]: '#EC4899', // Pink
        [0xFF10B981]: '#10B981', // Emerald
        [0xFFF59E0B]: '#F59E0B', // Amber
        [0xFF8B5CF6]: '#8B5CF6', // Violet
        [0xFF06B6D4]: '#06B6D4', // Cyan
        [0xFFEF4444]: '#EF4444', // Red
        [0xFF84CC16]: '#84CC16'  // Lime
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
                    isHost: p.isHost || false,
                    uid: p.uid
                });
            });
            updatePlayerList();
            updateLobbyPlayers();
            updateTurnIndicator();
        });

        // Track disconnected players
        Room.listen('disconnected', (snap) => {
            const data = snap.val();
            disconnectedIds = data ? Object.keys(data).map(Number) : [];
            updatePlayerList();
            updateTurnIndicator();
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
            // Show finish button only after 5+ words
            const finishBtn = document.getElementById('btn-vote-finish');
            if (finishBtn) finishBtn.classList.toggle('hidden', words.length < 5);
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
                hasVotedToExtend = false;

                // Waiting-for-turn music: play when it's NOT my turn, stop when it IS
                const isMyTurn = currentPlayerIndex === Room.myIndex;
                if (typeof Sound !== 'undefined') {
                    if (isMyTurn) {
                        Sound.stopMusic();
                    } else if (typeof App !== 'undefined') {
                        Sound.startMusic(App.selectedWaitingMusic || App.selectedMusicStyle || 'jazz');
                    }
                }
            }
            // Show +30s button for non-active players when timer is on
            const extendBtn = document.getElementById('btn-time-extend');
            if (extendBtn) {
                const isMyTurn = currentPlayerIndex === Room.myIndex;
                extendBtn.classList.toggle('hidden', isMyTurn || turnTimerSeconds <= 0);
            }
        });

        // Game started
        Room.listen('meta/isStarted', (snap) => {
            if (snap.val() === true) {
                if (typeof Sound !== 'undefined') Sound.stopMusic();
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
            const humanCount = players.length;
            if (voteEl) {
                voteEl.textContent = finishVoteCount > 0 ? '(' + finishVoteCount + '/' + humanCount + ')' : '';
            }
            // Check if all human players voted to finish
            if (finishVoteCount >= humanCount && humanCount > 0 && Room.isHost) {
                finishGame();
            }
        });

        // Time extension votes
        Room.listen('meta/timeExtensionVotes', (snap) => {
            const votes = snap.numChildren();
            const humanCount = players.length;
            const eligible = Math.max(1, humanCount - 1);
            const el = document.getElementById('extend-vote-count');
            if (el) el.textContent = votes > 0 ? '(' + votes + '/' + eligible + ')' : '';
            if (eligible > 0 && votes > eligible / 2) {
                timerRemaining += 30;
                if (Room.ref) Room.ref.child('meta/timeExtensionVotes').remove();
                hasVotedToExtend = false;
            }
        });

        document.getElementById('btn-time-extend').addEventListener('click', () => {
            if (hasVotedToExtend || !Room.ref) return;
            hasVotedToExtend = true;
            Room.ref.child('meta/timeExtensionVotes/' + Room.myIndex).set(true);
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
        let previousObjectives = {};
        let secretRevealed = false;
        let mySecretWord = '';
        Room.listen('objectives', (snap) => {
            const data = snap.val();
            const area = document.getElementById('secret-word-area');
            const wordEl = document.getElementById('secret-word');
            const statusEl = document.getElementById('secret-status');
            if (!data) {
                area.classList.add('hidden');
                return;
            }
            // Find my objective
            const myObj = data[Room.myIndex];
            if (myObj && myObj.secretWord) {
                area.classList.remove('hidden');
                mySecretWord = myObj.secretWord;
                if (myObj.completed && myObj.busted) {
                    wordEl.textContent = myObj.secretWord;
                    wordEl.style.textDecoration = 'line-through';
                    wordEl.style.opacity = '0.5';
                    statusEl.textContent = 'BUSTED!';
                    statusEl.style.color = '#EF4444';
                    secretRevealed = true;
                } else if (myObj.completed) {
                    wordEl.textContent = myObj.secretWord;
                    wordEl.style.textDecoration = 'line-through';
                    wordEl.style.opacity = '0.5';
                    statusEl.textContent = 'COMPLETE!';
                    statusEl.style.color = '#10B981';
                    secretRevealed = true;
                } else if (secretRevealed) {
                    wordEl.textContent = myObj.secretWord;
                    wordEl.style.textDecoration = 'none';
                    wordEl.style.opacity = '1';
                    statusEl.textContent = '';
                } else {
                    wordEl.textContent = 'Tap to reveal';
                    wordEl.style.textDecoration = 'none';
                    wordEl.style.opacity = '1';
                    statusEl.textContent = '';
                }
            }

            // Check for newly completed objectives (notifications)
            Object.entries(data).forEach(([idx, obj]) => {
                const prevObj = previousObjectives[idx];
                if (obj.completed && (!prevObj || !prevObj.completed)) {
                    const player = players[parseInt(idx)];
                    if (player && parseInt(idx) !== Room.myIndex) {
                        showObjectiveNotification(player, obj.secretWord || '???');
                    }
                }
                // Wrong guess notification
                if (obj.wrongGuessBy !== undefined && (!prevObj || prevObj.wrongGuessBy !== obj.wrongGuessBy)) {
                    const guesser = players[obj.wrongGuessBy];
                    const target = players[parseInt(idx)];
                    if (guesser && target) {
                        showToast(guesser.name + ' guessed wrong on ' + target.name + "'s word!", '#F59E0B');
                    }
                }
            });
            previousObjectives = JSON.parse(JSON.stringify(data));
        });

        // Tap-to-reveal secret word
        document.getElementById('secret-word-row').addEventListener('click', () => {
            if (!secretRevealed && mySecretWord) {
                secretRevealed = true;
                document.getElementById('secret-word').textContent = mySecretWord;
            }
        });

        // Guess word button
        document.getElementById('btn-guess-word').addEventListener('click', openGuessModal);
        document.getElementById('btn-close-guess').addEventListener('click', () => {
            document.getElementById('guess-modal').classList.add('hidden');
        });
        document.getElementById('btn-submit-guess').addEventListener('click', submitGuess);

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

        // Preserve viewport position on mobile
        const scrollY = window.scrollY;

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

        // Auto-scroll story area to bottom, restore viewport
        const storyArea = document.getElementById('story-area');
        if (storyArea) {
            storyArea.scrollTop = storyArea.scrollHeight;
        }
        window.scrollTo(0, scrollY);
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

        // Update player order bar
        const bar = document.getElementById('player-order-bar');
        if (bar && players.length > 0) {
            bar.innerHTML = '';
            players.forEach((p, i) => {
                const chip = document.createElement('div');
                const isDisconnected = disconnectedIds.includes(p.id);
                chip.className = 'player-order-chip' + (i === currentPlayerIndex ? ' active' : '') +
                    (i === Room.myIndex ? ' me' : '') + (isDisconnected ? ' disconnected' : '');
                chip.style.borderColor = getPlayerColor(p.color);
                if (i === currentPlayerIndex) chip.style.background = getPlayerColor(p.color) + '30';
                chip.innerHTML = '<span class="po-avatar">' + (p.avatar || '\u{1F60A}') + '</span>' +
                    '<span class="po-name" style="color:' + getPlayerColor(p.color) + '">' + p.name + '</span>';
                bar.appendChild(chip);
            });
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
        // Update finishTotal so Android host knows the threshold
        if (Room.ref) {
            Room.ref.child('votes/finishTotal').set(players.length);
        }
        const btn = document.getElementById('btn-vote-finish');
        if (btn) {
            btn.style.background = hasVotedToFinish ? 'rgba(16,185,129,0.2)' : 'transparent';
            btn.style.color = hasVotedToFinish ? '#10B981' : 'var(--text-secondary)';
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
        if (typeof Sound !== 'undefined') { Sound.stopMusic(); Sound.playGameEnd(); }

        App.showScreen('results');

        // Grade color
        const gradeChar = (data.storyGrade || 'C').charAt(0);
        const gradeColors = { A: '#10B981', B: '#6366F1', C: '#F59E0B', D: '#EF4444', F: '#EF4444' };
        const gradeColor = gradeColors[gradeChar] || '#F59E0B';

        // Illustration + Grade + Genre + Tags
        const illustrationEl = document.getElementById('result-illustration');
        if (illustrationEl) illustrationEl.textContent = data.illustration || '';

        const gradeEl = document.getElementById('result-grade');
        gradeEl.textContent = data.storyGrade || 'C';
        gradeEl.style.cssText = 'font-size:72px;font-weight:900;color:' + gradeColor;
        gradeEl.style.webkitBackgroundClip = '';
        gradeEl.style.webkitTextFillColor = '';

        document.getElementById('result-genre').textContent =
            (data.genreDetected || '') + (data.moodDetected ? ' \u2022 ' + data.moodDetected : '');

        const tagsEl = document.getElementById('result-tags');
        if (tagsEl && data.tags && data.tags.length > 0) {
            tagsEl.innerHTML = data.tags.map(t => '<span class="result-tag">' + t + '</span>').join('');
        } else if (tagsEl) {
            tagsEl.innerHTML = '';
        }

        // Summary card
        const summaryEl = document.getElementById('result-summary');
        if (summaryEl) {
            summaryEl.textContent = data.summary || '';
            summaryEl.classList.toggle('hidden', !data.summary);
        }

        // Player-colored story words with quotes
        const resultStoryEl = document.getElementById('result-story-text');
        resultStoryEl.innerHTML = '';
        if (words.length > 0) {
            // Add opening quote
            const openQuote = document.createElement('span');
            openQuote.textContent = '\u201C';
            openQuote.style.color = '#666680';
            resultStoryEl.appendChild(openQuote);
            words.forEach((w, i) => {
                const span = document.createElement('span');
                const player = players.find(p => p.id === w.playerId);
                if (player) span.style.color = getPlayerColor(player.color);
                else if (w.playerId === -1) { span.style.color = '#666680'; span.style.fontStyle = 'italic'; }
                span.textContent = (i > 0 ? ' ' : '') + w.word;
                resultStoryEl.appendChild(span);
            });
            const closeQuote = document.createElement('span');
            closeQuote.textContent = '\u201D';
            closeQuote.style.color = '#666680';
            resultStoryEl.appendChild(closeQuote);
        } else {
            resultStoryEl.textContent = data.fullStory || '';
        }

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
            if (val) val.textContent = s.value + '/100';
        });

        // Hidden objectives results
        let objectivesData = null;
        const objectivesPromise = Room.ref ? Room.ref.child('objectives').once('value').then(snap => {
            objectivesData = snap.val();
            if (!objectivesData) return;
            const container = document.getElementById('result-objectives');
            if (!container) return;
            container.innerHTML = '<h4 class="result-section-title">Hidden Objectives</h4>';
            container.classList.remove('hidden');
            Object.entries(objectivesData).forEach(([idx, obj]) => {
                const player = players[parseInt(idx)];
                if (!player || !obj.secretWord) return;
                const word = obj.secretWord || obj.word;
                const succeeded = obj.completed && !obj.busted;
                const status = obj.completed ? (obj.busted ? 'Busted!' : 'Snuck it in!') : 'Failed';
                const cls = succeeded ? 'obj-success' : 'obj-fail';
                const points = succeeded ? '+15' : '-5';
                const pointsCls = succeeded ? 'obj-success' : 'obj-fail';
                const item = document.createElement('div');
                item.className = 'objective-result-item';
                item.innerHTML = '<span class="player-stat-avatar">' + (player.avatar || '\u{1F60A}') + '</span>' +
                    '<span style="flex:1">' + player.name + ': "' + word + '"<br><span class="' + cls + '" style="font-size:12px">' + status + '</span></span>' +
                    '<span class="' + pointsCls + '" style="font-weight:700;font-size:16px">' + points + '</span>';
                container.appendChild(item);
            });
        }) : Promise.resolve();

        // Process player stats
        const statsArray = data.playerStats ?
            (Array.isArray(data.playerStats) ? data.playerStats : Object.values(data.playerStats)) : [];
        statsArray.sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0));

        // XP Breakdown + Podium + Report Cards (after objectives loaded for XP calc)
        objectivesPromise.then(() => {
            renderXPBreakdown(data, statsArray, objectivesData);
            renderPodium(statsArray);
            renderReportCards(data, statsArray);
        });

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
            readBtn.innerHTML = '&#128264;';
            readBtn.title = 'Read Story';
        }

        // Share button
        const shareBtn = document.getElementById('btn-copy-story');
        if (shareBtn) {
            shareBtn.innerHTML = '&#128228;';
            shareBtn.title = 'Share Story';
            shareBtn.onclick = () => {
                const entry = {
                    story: data.fullStory || document.getElementById('result-story-text').textContent,
                    grade: data.storyGrade,
                    genre: data.genreDetected,
                    mood: data.moodDetected,
                    illustration: data.illustration,
                    tags: data.tags,
                    playerNames: players.map(p => p.name),
                    wordCount: data.totalWords || words.length
                };
                if (typeof App.shareStory === 'function') {
                    App.shareStory(entry, shareBtn);
                }
            };
        }
    }

    function renderXPBreakdown(data, statsArray, objectivesData) {
        const container = document.getElementById('result-xp-breakdown');
        const list = document.getElementById('xp-breakdown-list');
        if (!container || !list || statsArray.length === 0) return;
        container.classList.remove('hidden');
        list.innerHTML = '';

        const maxImpact = Math.max(...statsArray.map(s => s.impactScore || 0));
        const totalWords = data.totalWords || words.length || 0;

        statsArray.forEach((ps, i) => {
            const isWinner = (ps.impactScore || 0) === maxImpact;
            let xp = 50;
            xp += Math.round((ps.impactScore || 0) / 2);
            const grade = (data.storyGrade || '').charAt(0);
            xp += grade === 'A' ? 40 : grade === 'B' ? 25 : grade === 'C' ? 15 : 5;
            if (isWinner) xp += 30;
            // Objective bonus
            const playerIdx = players.findIndex(p => p.name === ps.playerName);
            if (objectivesData && objectivesData[playerIdx]) {
                const obj = objectivesData[playerIdx];
                if (obj.completed && !obj.busted) xp += 15;
                else xp -= 5;
            }
            xp = Math.round(xp * Math.min(1.0, totalWords / 20));
            xp = Math.max(5, xp);

            // Calculate level
            const level = Math.floor(xp / 100) + 1;

            const row = document.createElement('div');
            row.className = 'xp-row';
            row.innerHTML = '<span class="xp-row-name">' + (ps.playerName || '?') + '</span>' +
                '<span class="xp-row-value">+' + xp + ' XP</span>' +
                '<span class="xp-row-level">Lv.' + level + '</span>';
            list.appendChild(row);
        });

        // Also show the single XP earned text
        const xpSection = document.getElementById('xp-earned-section');
        if (xpSection) xpSection.classList.add('hidden');
    }

    function renderPodium(statsArray) {
        const container = document.getElementById('result-podium');
        const display = document.getElementById('podium-display');
        if (!container || !display || statsArray.length < 2) return;
        container.classList.remove('hidden');
        display.innerHTML = '';

        // Podium order: 2nd, 1st, 3rd (visual placement)
        const sorted = [...statsArray].sort((a, b) => (b.impactScore || 0) - (a.impactScore || 0));
        const podiumOrder = [];
        if (sorted[1]) podiumOrder.push({ ...sorted[1], rank: 2 });
        if (sorted[0]) podiumOrder.push({ ...sorted[0], rank: 1 });
        if (sorted[2]) podiumOrder.push({ ...sorted[2], rank: 3 });

        const heights = { 1: 120, 2: 90, 3: 70 };
        const colors = { 1: '#B8860B', 2: '#9CA3AF', 3: '#CD7F32' };
        const labels = { 1: '1st', 2: '2nd', 3: '3rd' };

        podiumOrder.forEach(ps => {
            const col = document.createElement('div');
            col.className = 'podium-col';
            const player = players.find(p => p.name === ps.playerName);
            col.innerHTML =
                '<div class="podium-avatar">' + (ps.playerAvatar || player?.avatar || '\u{1F60A}') + '</div>' +
                '<div class="podium-name" style="color:' + (player ? getPlayerColor(player.color) : '#fff') + '">' +
                    (ps.playerName || '?') + '</div>' +
                '<div class="podium-score">' + (ps.impactScore || 0) + '</div>' +
                '<div class="podium-bar" style="height:' + heights[ps.rank] + 'px;background:' + colors[ps.rank] + '">' +
                    '<span class="podium-rank">' + labels[ps.rank] + '</span>' +
                '</div>';
            display.appendChild(col);
        });
    }

    function renderReportCards(data, statsArray) {
        const container = document.getElementById('result-report-cards');
        const list = document.getElementById('report-cards-list');
        if (!container || !list || statsArray.length === 0) return;
        container.classList.remove('hidden');
        list.innerHTML = '';

        statsArray.forEach((ps, rank) => {
            const player = players.find(p => p.name === ps.playerName);
            const card = document.createElement('div');
            card.className = 'report-card';
            const playerColor = player ? getPlayerColor(player.color) : '#A0A0B8';

            // Determine comment
            const uniqueRatio = (ps.wordCount || 0) > 0 ? (ps.uniqueWords || 0) / (ps.wordCount || 1) : 0;
            let comment = '';
            if (uniqueRatio >= 1.0) comment = 'Never repeated a word. Every contribution was fresh and unique.';
            else if (uniqueRatio >= 0.9) comment = 'Almost never repeated a word. A remarkably varied vocabulary.';
            else if (uniqueRatio >= 0.7) comment = 'Good variety in word choices with minimal repetition.';
            else comment = 'Contributed steadily to the story with reliable word choices.';

            card.innerHTML =
                '<div class="report-card-header">' +
                    '<span class="report-rank">#' + (rank + 1) + '</span>' +
                    '<span class="player-stat-avatar">' + (ps.playerAvatar || player?.avatar || '\u{1F60A}') + '</span>' +
                    '<div style="flex:1">' +
                        '<div class="player-stat-name" style="color:' + playerColor + '">' + (ps.playerName || '?') + '</div>' +
                        '<div class="player-stat-title">' + (ps.title || '') + '</div>' +
                    '</div>' +
                    '<div class="report-impact">' + (ps.impactScore || 0) + '</div>' +
                '</div>' +
                '<p class="report-comment">' + comment + '</p>' +
                '<div class="report-stats-grid">' +
                    '<div class="report-stat"><div class="report-stat-value">' + (ps.wordCount || 0) + '</div><div class="report-stat-label">Words</div></div>' +
                    '<div class="report-stat"><div class="report-stat-value">' + (ps.uniqueWords || ps.wordCount || 0) + '</div><div class="report-stat-label">Unique</div></div>' +
                    '<div class="report-stat"><div class="report-stat-value">' + (ps.avgWordLength || '0') + '</div><div class="report-stat-label">Avg Len</div></div>' +
                '</div>' +
                '<div class="report-language">' +
                    '<span class="lang-badge">' + (ps.languageLevel || 'A1') + '</span> ' +
                    '<span class="lang-name">' + (ps.languageLevelName || 'Beginner') + '</span>' +
                    (ps.bestWord ? '<span class="report-best">Best word: "' + ps.bestWord + '"</span>' : '') +
                '</div>' +
                (ps.longestWord ? '<div class="report-longest">Longest word: "' + ps.longestWord + '"</div>' : '');
            list.appendChild(card);
        });
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

        // Scale XP by story length — short stories earn less
        const totalWords = data.totalWords || words.length || 0;
        xp = Math.round(xp * Math.min(1.0, totalWords / 20));
        xp = Math.max(5, xp);

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

            // Track friends (other players in this game)
            try {
                const maxImpactVal = Math.max(...allStats.map(s => s.impactScore || 0));
                const myWon = (myStats.impactScore || 0) === maxImpactVal;
                for (const p of players) {
                    if (!p.uid || p.uid === Auth.uid) continue;
                    const friendRef = db.ref('users/' + Auth.uid + '/friends/' + p.uid);
                    const fSnap = await friendRef.once('value');
                    const existing = fSnap.val() || {};
                    await friendRef.update({
                        name: p.name,
                        avatar: p.avatar || '',
                        gamesTogether: (existing.gamesTogether || 0) + 1,
                        wins: (existing.wins || 0) + (myWon ? 1 : 0),
                        losses: (existing.losses || 0) + (myWon ? 0 : 1),
                        lastPlayed: firebase.database.ServerValue.TIMESTAMP
                    });
                }
            } catch (e) {}
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

    // --- Secret word guess UI ---
    let guessTargetIdx = null;
    function openGuessModal() {
        const modal = document.getElementById('guess-modal');
        const list = document.getElementById('guess-player-list');
        const inputArea = document.getElementById('guess-input-area');
        inputArea.classList.add('hidden');
        guessTargetIdx = null;
        list.innerHTML = '';
        players.forEach((p, i) => {
            if (i === Room.myIndex) return;
            const btn = document.createElement('button');
            btn.className = 'btn btn-ghost guess-player-btn';
            btn.innerHTML = '<span class="player-stat-avatar">' + (p.avatar || '\u{1F60A}') + '</span> ' + p.name;
            btn.style.color = getPlayerColor(p.color);
            btn.addEventListener('click', () => {
                guessTargetIdx = i;
                list.querySelectorAll('.guess-player-btn').forEach(b => b.style.outline = 'none');
                btn.style.outline = '2px solid ' + getPlayerColor(p.color);
                inputArea.classList.remove('hidden');
                document.getElementById('guess-word-input').focus();
            });
            list.appendChild(btn);
        });
        modal.classList.remove('hidden');
    }

    function submitGuess() {
        if (guessTargetIdx === null) return;
        const input = document.getElementById('guess-word-input');
        const guess = input.value.trim().toLowerCase();
        if (!guess) return;
        input.value = '';

        // Check against Firebase objectives
        if (Room.ref) {
            Room.ref.child('objectives/' + guessTargetIdx).once('value').then(snap => {
                const obj = snap.val();
                if (!obj || !obj.secretWord) return;
                const correct = guess === obj.secretWord.toLowerCase();
                if (correct) {
                    Room.ref.child('objectives/' + guessTargetIdx + '/busted').set(true);
                    Room.ref.child('objectives/' + guessTargetIdx + '/bustedBy').set(Room.myIndex);
                    Room.ref.child('objectives/' + guessTargetIdx + '/completed').set(true);
                    showToast('Correct! You busted ' + (players[guessTargetIdx]?.name || '?') + '\'s word!', '#10B981');
                } else {
                    // Broadcast wrong guess to all players
                    Room.ref.child('objectives/' + guessTargetIdx + '/wrongGuessBy').set(Room.myIndex);
                    showToast('Wrong guess! That\'s not their word.', '#EF4444');
                }
            });
        }
        document.getElementById('guess-modal').classList.add('hidden');
    }

    function showObjectiveNotification(player, word) {
        const toast = document.createElement('div');
        toast.className = 'objective-toast';
        toast.innerHTML = '<span>' + (player.avatar || '\u{1F60A}') + '</span> <b>' +
            player.name + '</b> snuck in their secret word!';
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
    }

    function showToast(message, color) {
        const toast = document.createElement('div');
        toast.className = 'objective-toast';
        toast.style.borderColor = color;
        toast.innerHTML = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2500);
    }

    function cleanup() {
        if (timerInterval) clearInterval(timerInterval);
        players = [];
        words = [];
        currentPlayerIndex = 0;
        turnWordCount = 0;
        hasVotedToFinish = false;
        finishVoteCount = 0;
        disconnectedIds = [];
        secretRevealed = false;
        mySecretWord = '';
        previousObjectives = {};
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
