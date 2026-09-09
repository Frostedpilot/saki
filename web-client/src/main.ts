import { render } from 'lit-html';
import './styles/main.scss';
import { GameSocket } from './net/socket';
import { GameStore } from './state/store';
import { renderBoard } from './components/board';
import { renderLobby } from './components/lobby-view';

const socket = new GameSocket();
const store = new GameStore(socket);
(window as any).__store = store;

const app = document.getElementById('app')!;

function updateApp(): void {
  const content = store.screen === 'game' ? renderBoard(store) : renderLobby(store);
  render(content, app);
}

// Subscribe to reactive store changes
store.subscribe(updateApp);

// Initial render
updateApp();

// Connect to bridge server
socket.connect();
socket.onStatus((status) => {
  if (status === 'connected') {
    store.sendHello('Player');
  }
});
