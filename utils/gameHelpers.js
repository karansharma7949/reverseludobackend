import { positions4Player, positions5Player, positions6Player, starPositions, boardConfig } from '../data/positions.js';

// Generate unique room ID
export function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Assign color to player based on number of existing players
// ANTI-CLOCKWISE turn order:
// 4 players: red > blue > yellow > green > red
// 5 players: red > green > orange > blue > yellow > red
// 6 players: red > orange > green > yellow > purple > blue > red
export function assignColor(players, noOfPlayers) {
  console.log('🎨 ========================================');
  console.log('🎨 COLOR ASSIGNMENT DEBUG');
  console.log('🎨 ========================================');
  console.log('   noOfPlayers:', noOfPlayers);
  console.log('   existing players:', players);
  console.log('   player count:', Object.keys(players).length);
  
  let availableColors;
  
  if (noOfPlayers === 2) {
    // 2-player: diagonal positions (red vs yellow)
    availableColors = ['red', 'yellow'];
    console.log('   ✅ 2-PLAYER MODE: Using diagonal colors [red, yellow]');
  } else if (noOfPlayers === 3) {
    // 3-player: anti-clockwise spacing
    availableColors = ['red', 'yellow', 'green'];
    console.log('   ✅ 3-PLAYER MODE: Using anti-clockwise colors [red, yellow, green]');
  } else if (noOfPlayers === 4) {
    // 4-player: anti-clockwise: red > blue > yellow > green
    availableColors = ['red', 'blue', 'yellow', 'green'];
    console.log('   ✅ 4-PLAYER MODE: Using anti-clockwise colors [red, blue, yellow, green]');
  } else if (noOfPlayers === 5) {
    // 5-player: anti-clockwise: red > green > orange > blue > yellow
    availableColors = ['red', 'green', 'orange', 'blue', 'yellow'];
    console.log('   ✅ 5-PLAYER MODE: Using anti-clockwise colors [red, green, orange, blue, yellow]');
  } else {
    // 6-player: anti-clockwise: red > orange > green > yellow > purple > blue
    availableColors = ['red', 'orange', 'green', 'yellow', 'purple', 'blue'];
    console.log('   ✅ 6-PLAYER MODE: Using anti-clockwise colors [red, orange, green, yellow, purple, blue]');
  }
  
  const usedColors = Object.values(players);
  console.log('   usedColors:', usedColors);
  console.log('   availableColors:', availableColors);
  
  for (const color of availableColors) {
    if (!usedColors.includes(color)) {
      console.log('   ✅ ASSIGNED COLOR:', color);
      console.log('🎨 ========================================');
      return color;
    }
  }
  
  console.log('   ❌ NO AVAILABLE COLORS - ROOM FULL');
  console.log('🎨 ========================================');
  return null;
}

// Initialize positions for active players only
export function initializePositions(players) {
  const positions = {};
  for (const color of Object.values(players)) {
    positions[color] = {
      tokenA: 0,
      tokenB: 0,
      tokenC: 0,
      tokenD: 0
    };
  }
  return positions;
}

// Get board position for a token
export function getBoardPosition(color, index, noOfPlayers) {
  if (noOfPlayers <= 4) {
    const colorPositions = positions4Player[color];
    if (colorPositions && colorPositions[index]) {
      return { type: 'grid', pos: colorPositions[index] };
    }
  } else if (noOfPlayers === 5) {
    const colorPositions = positions5Player[color];
    if (colorPositions && colorPositions[index]) {
      return { type: 'vector', pos: colorPositions[index] };
    }
  } else {
    const colorPositions = positions6Player[color];
    if (colorPositions && colorPositions[index]) {
      return { type: 'vector', pos: colorPositions[index] };
    }
  }
  return null;
}

// Check if two positions are the same (for kill detection)
export function arePositionsSame(pos1, pos2, noOfPlayers) {
  if (!pos1 || !pos2) {
    console.log(`  arePositionsSame: null position - pos1=${JSON.stringify(pos1)}, pos2=${JSON.stringify(pos2)}`);
    return false;
  }
  
  if (noOfPlayers <= 4) {
    const match = pos1.pos[0] === pos2.pos[0] && pos1.pos[1] === pos2.pos[1];
    console.log(`  Grid compare: [${pos1.pos}] vs [${pos2.pos}] = ${match}`);
    return match;
  } else {
    const dx = Math.abs(pos1.pos[0] - pos2.pos[0]);
    const dy = Math.abs(pos1.pos[1] - pos2.pos[1]);
    const match = dx <= 30 && dy <= 30;
    console.log(`  Vector compare: [${pos1.pos}] vs [${pos2.pos}], dx=${dx}, dy=${dy} = ${match}`);
    return match;
  }
}

// Get star positions for board type
export function getStarPositions(noOfPlayers) {
  if (noOfPlayers <= 4) return starPositions[4];
  if (noOfPlayers === 5) return starPositions[5];
  return starPositions[6];
}

// Get board config (final/home positions)
export function getBoardConfig(noOfPlayers) {
  if (noOfPlayers <= 4) return boardConfig[4];
  if (noOfPlayers === 5) return boardConfig[5];
  return boardConfig[6];
}

// Check for kills and return updated positions
export function checkForKills(gameRoom, color, newPosition, updatedPositions) {
  const noOfPlayers = gameRoom.no_of_players || 4;
  const stars = getStarPositions(noOfPlayers);
  const { finalPosition } = getBoardConfig(noOfPlayers);
  
  const isOnSafeSpot = stars.includes(newPosition);
  let bonusRoll = false;
  
  console.log(`\n=== KILL CHECK ===`);
  console.log(`${color} moving to position ${newPosition}`);
  console.log(`isOnSafeSpot: ${isOnSafeSpot}, finalPosition: ${finalPosition}`);
  
  if (!isOnSafeSpot && newPosition > 0 && newPosition < finalPosition) {
    const movingTokenBoardPos = getBoardPosition(color, newPosition, noOfPlayers);
    console.log(`Moving token board position:`, movingTokenBoardPos);
    
    for (const [opponentColor, tokens] of Object.entries(gameRoom.positions)) {
      if (opponentColor === color) continue;
      
      for (const [opponentToken, opponentPos] of Object.entries(tokens)) {
        if (opponentPos <= 0 || opponentPos >= finalPosition) continue;
        
        const opponentBoardPos = getBoardPosition(opponentColor, opponentPos, noOfPlayers);
        console.log(`Checking ${opponentColor} ${opponentToken} at index ${opponentPos}:`, opponentBoardPos);
        
        const match = arePositionsSame(movingTokenBoardPos, opponentBoardPos, noOfPlayers);
        console.log(`Positions match: ${match}`);
        
        if (match) {
          updatedPositions[opponentColor][opponentToken] = 0;
          bonusRoll = true;
          console.log(`🎯 KILL! ${color} killed ${opponentColor}'s ${opponentToken}!`);
        }
      }
    }
  } else {
    console.log(`Skipping kill check - safe spot or home column`);
  }
  console.log(`=== END KILL CHECK ===\n`);
  
  return { updatedPositions, bonusRoll };
}

// Check if player has valid moves
export function hasValidMoves(playerPositions, diceResult, noOfPlayers) {
  const { homePosition } = getBoardConfig(noOfPlayers);
  
  for (const tokenName in playerPositions) {
    const currentPos = playerPositions[tokenName];
    
    if (currentPos === 0) {
      // Token at home - can only exit with a 6
      if (diceResult === 6) return true;
    } else if (currentPos >= homePosition) {
      // Token already at final position (home center) - cannot move
      continue;
    } else {
      // Token on board or in home column (1 to homePosition-1)
      // Can move if new position doesn't exceed homePosition
      if (currentPos + diceResult <= homePosition) return true;
    }
  }
  return false;
}

// Check if all tokens reached home
export function checkAllTokensHome(positions, noOfPlayers) {
  const { homePosition } = getBoardConfig(noOfPlayers);
  return Object.values(positions).every(pos => pos === homePosition);
}

// Get next player turn
export function getNextTurn(playerIds, currentUserId) {
  const currentIndex = playerIds.indexOf(currentUserId);
  const nextIndex = (currentIndex + 1) % playerIds.length;
  return playerIds[nextIndex];
}

// Generate UUID v4 for bots
export function generateBotId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
