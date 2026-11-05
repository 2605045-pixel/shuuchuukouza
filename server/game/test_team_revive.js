const assert = require('assert');
const constants = require('./constants');
const GameRoom = require('./GameRoom');

// Mock socket.io
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

async function testTeamModeAndRevive() {
  console.log('--- Starting GameRoom Team & Revive Tests ---');

  const mockIo = new MockIO();
  const room = new GameRoom('test-room', mockIo);

  // 1. Test Game Mode Setting
  room.setGameMode(constants.GAME_MODES.TEAM_2V2);
  assert.strictEqual(room.gameMode, 'team2v2', 'Mode should be team2v2');

  // 2. Add 4 players
  const p1 = room.addPlayer('sock1', 'Alice');
  const p2 = room.addPlayer('sock2', 'Bob');
  const p3 = room.addPlayer('sock3', 'Charlie');
  const p4 = room.addPlayer('sock4', 'Diana');

  assert.strictEqual(room.players.size, 4, 'Should have 4 players');

  // Check team assignment
  room.setPlayerTeam('sock1', 'blue');
  room.setPlayerTeam('sock2', 'blue');
  room.setPlayerTeam('sock3', 'red');
  room.setPlayerTeam('sock4', 'red');

  assert.strictEqual(p1.team, 'blue');
  assert.strictEqual(p2.team, 'blue');
  assert.strictEqual(p3.team, 'red');
  assert.strictEqual(p4.team, 'red');

  // Check team limit (2v2 should reject a 3rd player joining blue)
  const room2 = new GameRoom('test-room2', mockIo);
  room2.setGameMode('team2v2');
  const r1 = room2.addPlayer('s1', 'P1');
  const r2 = room2.addPlayer('s2', 'P2');
  const r3 = room2.addPlayer('s3', 'P3');
  room2.setPlayerTeam('s1', 'blue');
  room2.setPlayerTeam('s2', 'blue');
  const joinRes = room2.setPlayerTeam('s3', 'blue');
  assert.strictEqual(joinRes.success, false, 'Should reject 3rd player in team2v2');
  console.log('✓ Team mode assignment and limits working correctly');

  // 3. Start Game
  const startRes = room.startGame('sock1');
  assert.strictEqual(startRes.success, true, 'Start game should succeed');
  assert.strictEqual(room.state, 'PLAYING', 'Game should be in PLAYING state');

  // Blue players should have spawn points on the left (x=1)
  assert.strictEqual(p1.spawnCol, 1);
  assert.strictEqual(p2.spawnCol, 1);
  // Red players on the right (x=13)
  assert.strictEqual(p3.spawnCol, 13);
  assert.strictEqual(p4.spawnCol, 13);
  console.log('✓ Spawns placed correctly for Team Blue and Team Red');

  // 4. Test Friendly Fire (Both teammates and enemies take damage)
  // Create an explosion covering p1 (blue) and p2 (blue teammate)
  const testCells = [
    p1.getTile(),
    p2.getTile()
  ];
  room.checkExplosionHit(testCells);
  assert.strictEqual(p1.alive, false, 'Teammate p1 should be hit by explosion (friendly fire)');
  assert.strictEqual(p2.alive, false, 'Teammate p2 should be hit by explosion (friendly fire)');
  console.log('✓ Friendly fire verified (explosions hit teammates and enemies)');

  // 5. Test Revive Power
  // Reset for revive test
  p1.alive = true;
  p2.alive = false; // Teammate dead
  p1.hasRevive = false;

  // Revive without power should fail
  const noPowerRes = room.reviveTeammate('sock1');
  assert.strictEqual(noPowerRes.success, false, 'Revive without power should fail');

  // Give p1 revive power
  p1.applyItem(constants.ITEM_TYPES.REVIVE);
  assert.strictEqual(p1.hasRevive, true, 'p1 should have revive power');

  // Revive teammate
  const reviveRes = room.reviveTeammate('sock1');
  assert.strictEqual(reviveRes.success, true, 'Revive should succeed');
  assert.strictEqual(p2.alive, true, 'Dead teammate p2 should now be alive');
  assert.strictEqual(p1.hasRevive, false, 'Revive power must be consumed/expired after single use');
  assert.strictEqual(p2.isInvulnerable(), true, 'Revived player should have invulnerability shield');

  // Attempting second revive should fail because power expired
  const secondReviveRes = room.reviveTeammate('sock1');
  assert.strictEqual(secondReviveRes.success, false, 'Second revive should fail (one-time use only)');
  console.log('✓ Teammate revive power verified (single use only, invulnerability shield granted, expires after use)');

  // 6. Test Invulnerability Protection from explosion
  room.checkExplosionHit([p2.getTile()]);
  assert.strictEqual(p2.alive, true, 'Invulnerable player must survive explosions during shield');
  console.log('✓ Invulnerability shield verified against explosions');

  // 7. Test Win Condition
  // Blue team: p1, p2. Red team: p3, p4.
  // Eliminate Red team:
  p3.alive = false;
  p4.alive = false;
  p1.alive = true;
  p2.alive = true;
  room.checkGameEnd();
  assert.strictEqual(room.state, 'GAMEOVER', 'Game should end when Red team is eliminated');
  assert.strictEqual(room.winnerTeam, 'blue', 'Blue team should win');
  assert.strictEqual(room.teamScores.blue, 1, 'Blue team score should increment');
  console.log('✓ Team win condition verified');

  // Stop loop
  room.stopLoop();
  room2.stopLoop();
  console.log('--- All Tests Passed Successfully! ---');
}

testTeamModeAndRevive().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
