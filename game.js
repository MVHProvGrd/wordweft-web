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
                    isConnected: p.isConnected !== false,
                    uid: p.uid
                });
            });
            // Derive disconnected list from isConnected field
            disconnectedIds = players.filter(p => !p.isConnected).map(p => p.id);
            updatePlayerList();
            updateLobbyPlayers();
            updateTurnIndicator();

            // Check if host disconnected
            const host = players.find(p => p.isHost);
            const hostDisconnected = host && disconnectedIds.includes(host.id);
            showHostMigration(hostDisconnected);

            // Auto-skip disconnected player's turn (host only)
            if (Room.isHost && players.length > 1) {
                const currentPlayer = players[currentPlayerIndex];
                if (currentPlayer && !currentPlayer.isConnected) {
                    const nextIndex = (currentPlayerIndex + 1) % players.length;
                    Room.advanceTurn(nextIndex, getWordsNeeded() || 1);
                }
            }
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

            // Auto-skip if turn landed on a disconnected player (host only)
            if (Room.isHost && players.length > 1) {
                const currentPlayer = players[currentPlayerIndex];
                if (currentPlayer && !currentPlayer.isConnected) {
                    const nextIndex = (currentPlayerIndex + 1) % players.length;
                    setTimeout(() => Room.advanceTurn(nextIndex, getWordsNeeded() || 1), 300);
                    return;
                }
            }

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
            if (timerInterval) clearInterval(timerInterval);
            Results.show(data, { players, words, getPlayerColor });
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
            const pColor = getPlayerColor(p.color);
            item.innerHTML = `
                <span class="player-item-avatar" style="background: ${pColor}33; border: 1.5px solid ${pColor}">${p.avatar || '\u{1F60A}'}</span>
                <span class="player-item-name" style="color: ${pColor}">${p.name}</span>
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
        const pColor = getPlayerColor(player.color);
        el.style.background = pColor + '26';
        el.style.borderRadius = '16px';
        el.style.padding = '6px 14px';
        if (isMyTurn) {
            el.innerHTML = '<span class="current-player">Your turn!</span>';
        } else {
            el.innerHTML = '<span style="color:' + pColor + '">' +
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
                    if (obj && obj.secretWord && !obj.completed) {
                        const submitted = wordsToSubmit.map(w => w.toLowerCase().replace(/[^a-z]/g, ''));
                        if (submitted.includes(obj.secretWord.toLowerCase())) {
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

    // Results rendering is now handled by the Results module (results.js)

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

    // Grade comparison now in Results module

    // awardXP, showAchievementProgress, showHighlights, ACHIEVEMENTS, launchConfetti
    // are now in the Results module (results.js)

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

    // Host migration
    let migrationTimer = null;
    let migrationCountdown = 30;

    function showHostMigration(hostGone) {
        const bar = document.getElementById('host-migration-bar');
        if (!bar) return;

        if (!hostGone) {
            bar.classList.add('hidden');
            if (migrationTimer) { clearInterval(migrationTimer); migrationTimer = null; }
            return;
        }

        bar.classList.remove('hidden');
        migrationCountdown = 30;
        const fill = document.getElementById('migration-progress-fill');
        if (fill) fill.style.width = '100%';

        if (migrationTimer) clearInterval(migrationTimer);
        migrationTimer = setInterval(() => {
            migrationCountdown--;
            if (fill) fill.style.width = (migrationCountdown / 30 * 100) + '%';
            const sub = bar.querySelector('.migration-sub');
            if (sub) sub.textContent = migrationCountdown > 0
                ? 'Waiting for host to reconnect... ' + migrationCountdown + 's'
                : 'Host did not return';
            if (migrationCountdown <= 0) {
                clearInterval(migrationTimer);
                migrationTimer = null;
            }
        }, 1000);

        document.getElementById('btn-migration-leave').onclick = () => {
            if (migrationTimer) { clearInterval(migrationTimer); migrationTimer = null; }
            bar.classList.add('hidden');
            Room.leave();
            App.showScreen('home');
        };
    }

    function cleanup() {
        if (timerInterval) clearInterval(timerInterval);
        if (migrationTimer) { clearInterval(migrationTimer); migrationTimer = null; }
        // TTS/replay state now in Results module
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
        get ACHIEVEMENTS() { return Results.ACHIEVEMENTS; },
        get players() { return players; },
        get words() { return words; },
        get currentPlayerIndex() { return currentPlayerIndex; },
        get gameMode() { return gameMode; }
    };
})();
