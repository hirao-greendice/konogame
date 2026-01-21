import './style.css';
import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, firebaseConfigMissing } from './firebase';

type ViewName = 'master' | 'screen' | 'player';

type RoomState = {
  stage?: string;
  question?: string;
  hint?: string;
  screenMessage?: string;
  allowAnswers?: boolean;
  roundId?: number;
};

type Answer = {
  playerId: string;
  playerName: string;
  text: string;
  roundId: number;
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('App root is missing.');
}

app.innerHTML = `
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">K</div>
        <div>
          <div class="brand-title">KONO NAZOLAB</div>
          <div class="brand-sub">Realtime Nazo Control Hub</div>
        </div>
      </div>
      <div class="room-controls card">
        <label class="label" for="roomIdInput">Room ID</label>
        <div class="room-row">
          <input id="roomIdInput" class="input" type="text" autocomplete="off" />
          <button id="roomConnect" class="btn btn-primary" type="button" data-firebase>
            接続
          </button>
        </div>
        <div class="room-meta">
          <span id="roomStatus" class="pill">ROOM --</span>
          <span id="roundStatus" class="pill">ROUND --</span>
        </div>
      </div>
    </header>

    <nav class="view-nav">
      <button class="view-btn" type="button" data-view="master">マスター操作</button>
      <button class="view-btn" type="button" data-view="screen">スクリーン</button>
      <button class="view-btn" type="button" data-view="player">プレイヤー</button>
    </nav>

    <div id="firebaseNotice" class="notice hidden" role="status"></div>

    <main class="views">
      <section class="view" id="view-master" data-view="master">
        <div class="view-header">
          <h1>マスター操作</h1>
          <p>進行を操作して、スクリーンとプレイヤーにリアルタイム共有。</p>
        </div>
        <div class="master-grid">
          <div class="card">
            <h2>進行コントロール</h2>
            <div class="form-grid">
              <div>
                <label class="label" for="stageInput">ステージ</label>
                <input id="stageInput" class="input" type="text" data-firebase />
              </div>
              <div>
                <label class="label" for="questionInput">問題</label>
                <textarea id="questionInput" class="textarea" rows="3" data-firebase></textarea>
              </div>
              <div>
                <label class="label" for="hintInput">ヒント</label>
                <textarea id="hintInput" class="textarea" rows="2" data-firebase></textarea>
              </div>
              <div>
                <label class="label" for="screenMessageInput">スクリーン用メッセージ</label>
                <textarea id="screenMessageInput" class="textarea" rows="2" data-firebase></textarea>
              </div>
            </div>
            <div class="actions">
              <button id="saveRoom" class="btn btn-primary" type="button" data-firebase>
                反映
              </button>
              <button id="toggleAnswers" class="btn btn-ghost" type="button" data-firebase>
                回答受付を止める
              </button>
              <button id="nextRound" class="btn btn-outline" type="button" data-firebase>
                次ラウンド
              </button>
            </div>
          </div>
          <div class="card answers-card">
            <div class="answers-head">
              <div>
                <h2>回答一覧</h2>
                <p class="muted">最新 50 件まで表示</p>
              </div>
              <div class="answers-meta">
                <span id="answersCount" class="pill">0 件</span>
                <span id="answersStatus" class="pill">--</span>
              </div>
            </div>
            <div id="answersList" class="answers-list"></div>
          </div>
        </div>
      </section>

      <section class="view" id="view-screen" data-view="screen">
        <div class="screen-shell">
          <div class="screen-header">
            <div id="screenStage" class="screen-stage">STAGE --</div>
            <div id="screenAllow" class="screen-allow">受付停止中</div>
          </div>
          <div class="screen-question" id="screenQuestion"></div>
          <div class="screen-hint" id="screenHint"></div>
          <div class="screen-message" id="screenMessage"></div>
          <div class="screen-footer">
            <span>回答数</span>
            <strong id="screenAnswerCount">0</strong>
          </div>
        </div>
      </section>

      <section class="view" id="view-player" data-view="player">
        <div class="player-grid">
          <div class="card player-card">
            <h2>回答を送る</h2>
            <div class="pill" id="playerAllow">受付停止中</div>
            <label class="label" for="playerNameInput">ニックネーム</label>
            <input id="playerNameInput" class="input" type="text" autocomplete="nickname" />
            <label class="label" for="playerAnswerInput">回答</label>
            <input id="playerAnswerInput" class="input" type="text" data-firebase />
            <button id="playerSend" class="btn btn-primary" type="button" data-firebase>
              送信
            </button>
            <div id="playerStatus" class="status-text"></div>
          </div>
          <div class="card player-info">
            <h2>現在の問題</h2>
            <div id="playerQuestion" class="player-question"></div>
            <div id="playerHint" class="player-hint"></div>
          </div>
        </div>
      </section>
    </main>
  </div>
`;

const $ = <T extends HTMLElement>(selector: string): T => {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Missing element: ${selector}`);
  }
  return el;
};

const roomIdInput = $('#roomIdInput') as HTMLInputElement;
const roomConnect = $('#roomConnect') as HTMLButtonElement;
const roomStatus = $('#roomStatus');
const roundStatus = $('#roundStatus');
const firebaseNotice = $('#firebaseNotice');

const stageInput = $('#stageInput') as HTMLInputElement;
const questionInput = $('#questionInput') as HTMLTextAreaElement;
const hintInput = $('#hintInput') as HTMLTextAreaElement;
const screenMessageInput = $('#screenMessageInput') as HTMLTextAreaElement;
const saveRoom = $('#saveRoom') as HTMLButtonElement;
const toggleAnswers = $('#toggleAnswers') as HTMLButtonElement;
const nextRound = $('#nextRound') as HTMLButtonElement;
const answersCount = $('#answersCount');
const answersStatus = $('#answersStatus');
const answersList = $('#answersList');

const screenStage = $('#screenStage');
const screenQuestion = $('#screenQuestion');
const screenHint = $('#screenHint');
const screenMessage = $('#screenMessage');
const screenAllow = $('#screenAllow');
const screenAnswerCount = $('#screenAnswerCount');

const playerNameInput = $('#playerNameInput') as HTMLInputElement;
const playerAnswerInput = $('#playerAnswerInput') as HTMLInputElement;
const playerSend = $('#playerSend') as HTMLButtonElement;
const playerStatus = $('#playerStatus');
const playerQuestion = $('#playerQuestion');
const playerHint = $('#playerHint');
const playerAllow = $('#playerAllow');

const viewButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-view]'),
);
const viewSections = Array.from(
  document.querySelectorAll<HTMLElement>('.view'),
);

const firebaseRequired = Array.from(
  document.querySelectorAll<HTMLElement>('[data-firebase]'),
);

let currentRoomId = localStorage.getItem('roomId') ?? 'demo';
let currentRoom: RoomState | null = null;
let currentRoundId = 0;
let roomUnsub: Unsubscribe | null = null;
let answersUnsub: Unsubscribe | null = null;

roomIdInput.value = currentRoomId;
playerNameInput.value = localStorage.getItem('playerName') ?? '';

const playerId = (() => {
  const stored = localStorage.getItem('playerId');
  if (stored) {
    return stored;
  }
  const generated =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `player_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  localStorage.setItem('playerId', generated);
  return generated;
})();

const setView = (view: ViewName) => {
  viewSections.forEach((section) => {
    section.classList.toggle('is-active', section.dataset.view === view);
  });
  viewButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === view);
  });
};

const isViewName = (value: string): value is ViewName =>
  value === 'master' || value === 'screen' || value === 'player';

const initialView = location.hash.replace('#', '');
setView(isViewName(initialView) ? initialView : 'master');

window.addEventListener('hashchange', () => {
  const view = location.hash.replace('#', '');
  if (isViewName(view)) {
    setView(view);
  }
});

viewButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const view = button.dataset.view;
    if (!view || !isViewName(view)) {
      return;
    }
    history.replaceState(null, '', `#${view}`);
    setView(view);
  });
});

const setFirebaseDisabled = (disabled: boolean) => {
  firebaseRequired.forEach((el) => {
    if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) {
      el.disabled = disabled;
    } else if (el instanceof HTMLTextAreaElement) {
      el.disabled = disabled;
    }
  });
};

if (firebaseConfigMissing.length > 0) {
  firebaseNotice.classList.remove('hidden');
  firebaseNotice.textContent = `Firebase 未設定: ${firebaseConfigMissing.join(
    ', ',
  )}`;
  setFirebaseDisabled(true);
} else {
  firebaseNotice.classList.add('hidden');
  setFirebaseDisabled(false);
}

const setRoom = (roomId: string) => {
  const trimmed = roomId.trim();
  if (!trimmed) {
    return;
  }
  currentRoomId = trimmed;
  currentRoundId = 0;
  localStorage.setItem('roomId', trimmed);
  roomStatus.textContent = `ROOM ${trimmed}`;
  if (!db) {
    roomStatus.textContent = 'Firebase 未設定';
    return;
  }
  subscribeRoom();
};

roomConnect.addEventListener('click', () => setRoom(roomIdInput.value));
roomIdInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    setRoom(roomIdInput.value);
  }
});

const updateRoomUI = (data: RoomState) => {
  stageInput.value = data.stage ?? '';
  questionInput.value = data.question ?? '';
  hintInput.value = data.hint ?? '';
  screenMessageInput.value = data.screenMessage ?? '';

  const questionText = data.question?.trim() || '問題を入力してください';
  const hintText = data.hint?.trim() || 'ヒントを入力してください';
  const messageText = data.screenMessage?.trim() || 'メッセージ待機中';

  screenStage.textContent = data.stage?.trim()
    ? `STAGE ${data.stage}`
    : 'STAGE --';
  screenQuestion.textContent = questionText;
  screenHint.textContent = hintText;
  screenMessage.textContent = messageText;

  playerQuestion.textContent = questionText;
  playerHint.textContent = hintText;

  const allowAnswers = data.allowAnswers ?? false;
  const allowText = allowAnswers ? '受付中' : '停止中';
  const screenAllowText = allowAnswers ? '回答受付中' : '受付停止中';

  answersStatus.textContent = allowText;
  screenAllow.textContent = screenAllowText;
  playerAllow.textContent = allowText;
  toggleAnswers.textContent = allowAnswers ? '回答受付を止める' : '回答受付を再開';

  playerAnswerInput.disabled = !allowAnswers;
  playerSend.disabled = !allowAnswers;

  roundStatus.textContent = `ROUND ${data.roundId ?? 1}`;
};

const renderAnswers = (answers: Answer[]) => {
  answersList.innerHTML = '';
  if (answers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'answers-empty';
    empty.textContent = 'まだ回答が届いていません。';
    answersList.appendChild(empty);
    return;
  }

  answers.forEach((answer) => {
    const item = document.createElement('div');
    item.className = 'answer-item';

    const name = document.createElement('div');
    name.className = 'answer-name';
    name.textContent = answer.playerName || 'プレイヤー';

    const text = document.createElement('div');
    text.className = 'answer-text';
    text.textContent = answer.text;

    item.append(name, text);
    answersList.appendChild(item);
  });
};

const subscribeAnswers = (roundId: number) => {
  if (!db) {
    return;
  }
  if (roundId === currentRoundId) {
    return;
  }
  currentRoundId = roundId;
  answersUnsub?.();
  const answersRef = collection(db, 'rooms', currentRoomId, 'answers');
  const answersQuery = query(
    answersRef,
    where('roundId', '==', roundId),
    orderBy('createdAt', 'desc'),
    limit(50),
  );
  answersUnsub = onSnapshot(answersQuery, (snapshot) => {
    answersCount.textContent = `${snapshot.size} 件`;
    screenAnswerCount.textContent = `${snapshot.size}`;
    const items = snapshot.docs.map((docSnap) => docSnap.data() as Answer);
    renderAnswers(items);
  });
};

const subscribeRoom = () => {
  if (!db) {
    return;
  }
  roomUnsub?.();
  answersUnsub?.();
  const roomRef = doc(db, 'rooms', currentRoomId);
  roomUnsub = onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) {
      const initial: RoomState = {
        stage: '1',
        question: '',
        hint: '',
        screenMessage: '',
        allowAnswers: true,
        roundId: 1,
      };
      setDoc(
        roomRef,
        {
          ...initial,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      currentRoom = initial;
      updateRoomUI(initial);
      subscribeAnswers(initial.roundId ?? 1);
      return;
    }
    const data = snap.data() as RoomState;
    currentRoom = data;
    updateRoomUI(data);
    subscribeAnswers(data.roundId ?? 1);
  });
};

saveRoom.addEventListener('click', async () => {
  if (!db) {
    return;
  }
  const roomRef = doc(db, 'rooms', currentRoomId);
  await setDoc(
    roomRef,
    {
      stage: stageInput.value.trim(),
      question: questionInput.value.trim(),
      hint: hintInput.value.trim(),
      screenMessage: screenMessageInput.value.trim(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
});

toggleAnswers.addEventListener('click', async () => {
  if (!db) {
    return;
  }
  const roomRef = doc(db, 'rooms', currentRoomId);
  const nextAllow = !(currentRoom?.allowAnswers ?? false);
  await setDoc(
    roomRef,
    {
      allowAnswers: nextAllow,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
});

nextRound.addEventListener('click', async () => {
  if (!db) {
    return;
  }
  const next = (currentRoom?.roundId ?? 0) + 1;
  const roomRef = doc(db, 'rooms', currentRoomId);
  await setDoc(
    roomRef,
    {
      roundId: next,
      allowAnswers: true,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
});

playerNameInput.addEventListener('input', () => {
  localStorage.setItem('playerName', playerNameInput.value);
});

const sendAnswer = async () => {
  if (!db) {
    return;
  }
  const text = playerAnswerInput.value.trim();
  if (!text) {
    playerStatus.textContent = '回答を入力してください。';
    return;
  }
  const playerName = playerNameInput.value.trim() || 'プレイヤー';
  const roundId = currentRoom?.roundId ?? 1;
  await addDoc(collection(db, 'rooms', currentRoomId, 'answers'), {
    playerId,
    playerName,
    text,
    roundId,
    createdAt: serverTimestamp(),
  });
  playerAnswerInput.value = '';
  playerStatus.textContent = '送信しました。';
};

playerSend.addEventListener('click', () => {
  void sendAnswer();
});

playerAnswerInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void sendAnswer();
  }
});

setRoom(currentRoomId);
