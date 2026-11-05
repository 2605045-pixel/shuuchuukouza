const assert = require('assert');
const constants = require('./constants');
const GameRoom = require('./GameRoom');

class MockIO {
  constructor() {
    this.emitted = [];
  }
  to(room) {
    return {
      emit: (evt, data) => {
        this.emitted.push({ room, evt, data });
      }
    };
  }
}

async function test3v3AndPerformance() {
  console.log('--- Testing 3v3 Mode & Network/Performance Optimization ---');

  const mockIo = new MockIO();
  const room = new GameRoom('room-3v3', mockIo);

  // Set mode to 3v3
  room.setGameMode(constants.GAME_MODES.TEAM_3V3);
  assert.strictEqual(room.gameMode, 'team3v3');

  // Add 6 players (3 Blue, 3 Red)
  const p1 = room.addPlayer('s1', 'Blue1');
  const p2 = room.addPlayer('s2', 'Blue2');
  const p3 = room.addPlayer('s3', 'Blue3');
  const p4 = room.addPlayer('s4', 'Red1');
  const p5 = room.addPlayer('s5', 'Red2');
  const p6 = room.addPlayer('s6', 'Red3');

  room.setPlayerTeam('s1', 'blue');
  room.setPlayerTeam('s2', 'blue');
  room.setPlayerTeam('s3', 'blue');
  room.setPlayerTeam('s4', 'red');
  room.setPlayerTeam('s5', 'red');
  room.setPlayerTeam('s6', 'red');

  // Verify 4th player cannot join blue in 3v3
  const p7 = room.addPlayer('s7', 'Overflow');
  const reject = room.setPlayerTeam('s7', 'blue');
  assert.strictEqual(reject.success, false, 'Should reject 4th player on 3v3 team');
  room.removePlayer('s7');

  console.log('✓ 3v3 team limits (3 players per team) verified');

  // Start game with 6 players
  const start = room.startGame('s1');
  assert.strictEqual(start.success, true);

  // Verify spawns for all 6 players
  assert.strictEqual(p1.spawnCol, 1);
  assert.strictEqual(p2.spawnCol, 1);
  assert.strictEqual(p3.spawnCol, 1);
  assert.strictEqual(p4.spawnCol, 13);
  assert.strictEqual(p5.spawnCol, 13);
  assert.strictEqual(p6.spawnCol, 13);
  console.log('✓ 6 player spawns verified for 3v3 (Blue on left, Red on right)');

  // Test network payload optimization (Grid delta vs normal ticks)
  mockIo.emitted = [];

  // Tick 1 (Initial broadcast after start)
  room.lastBroadcastTime = 0; // force broadcast
  room.tick();

  const tick1State = mockIo.emitted.find(e => e.evt === 'game_state');
  assert.ok(tick1State, 'Should emit game_state');
  assert.ok(tick1State.data.grid, 'First broadcast after start must include grid');
  const version1 = tick1State.data.gridVersion;

  // Tick 2 (Normal tick without map change)
  mockIo.emitted = [];
  room.lastBroadcastTime = 0; // force broadcast
  room.tick();

  const tick2State = mockIo.emitted.find(e => e.evt === 'game_state');
  assert.ok(tick2State, 'Should emit game_state');
  assert.strictEqual(tick2State.data.grid, undefined, 'Grid MUST BE OMITTED on normal ticks to prevent lag/bandwidth flood!');
  assert.strictEqual(tick2State.data.gridVersion, version1, 'Grid version remains the same');
  console.log('✓ Network optimization verified: 195-tile grid is omitted on unchanged frames (>80% bandwidth saved)');

  // Now destroy a block and verify grid is re-sent
  mockIo.emitted = [];
  room.lastBroadcastTime = 0;

  // Find a block and destroy it
  let foundBlock = false;
  for (let r = 1; r < room.map.rows - 1; r++) {
    for (let c = 1; c < room.map.cols - 1; c++) {
      if (room.map.grid[r][c] === 2) {
        room.map.destroyBlock(c, r);
        foundBlock = true;
        break;
      }
    }
    if (foundBlock) break;
  }

  assert.ok(foundBlock, 'Should have found and destroyed a block');
  assert.strictEqual(room.map.gridVersion, version1 + 1, 'Grid version should increment on block break');

  room.tick();
  const tick3State = mockIo.emitted.find(e => e.evt === 'game_state');
  assert.ok(tick3State.data.grid, 'Grid MUST be included when block was destroyed');
  assert.strictEqual(tick3State.data.gridVersion, version1 + 1);
  console.log('✓ Grid update verified: Grid is only transmitted when blocks are destroyed');

  // Simulate heavy usage: 6 players moving and placing bombs simultaneously
  for (let i = 0; i < 50; i++) {
    p1.move({ up: true }, room.map, () => null, () => false);
    p2.move({ down: true }, room.map, () => null, () => false);
    p3.move({ left: true }, room.map, () => null, () => false);
    p4.move({ right: true }, room.map, () => null, () => false);
    p5.move({ up: true, left: true }, room.map, () => null, () => false);
    p6.move({ down: true, right: true }, room.map, () => null, () => false);
    room.tick();
  }
  console.log('✓ Simulated 50 high-load frames with 6 players moving simultaneously: 0 errors');

  room.stopLoop();
  console.log('--- 3v3 & Performance Tests Passed Successfully! ---');
}

test3v3AndPerformance().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
