# MONOPOLY — web multiplayer

A web-playable Monopoly with the classic UK London board (Old Kent Road → Mayfair, £), official rules,
and room-code multiplayer. Server-authoritative (Node.js + Socket.IO), so nobody can cheat.

## Play it

```
npm install     (first time only)
npm start
```

Open **http://localhost:4000** (or pick another port: `PORT=5000 npm start`).

- **Create Game** → you get a 6-letter room code.
- Friends open the same address and **Join** with the code
  (or use the *Copy invite link* button in the lobby).
- **+ Add player on this device** = hot-seat players who share your screen.
- 2–8 players. Click any property tile to see its title deed.

### Playing with friends on your Wi-Fi
Find your PC's local IP (`ipconfig` → IPv4, e.g. `192.168.1.5`), then friends open
`http://192.168.1.5:4000` on their phones/laptops and join with the code.

### Hosting on the internet
The whole app is one Node server, so any Node host works (Render, Railway, Fly.io —
their free tiers are fine). Point the host at `npm start`; it respects `PORT`.
> Note: this uses real Monopoly branding, which belongs to Hasbro. Keep hosted
> versions private (don't share the URL publicly) to avoid takedown trouble.

## What's implemented (official rules)

- Dice, doubles (3 doubles → Jail), GO salary $200
- Buying, **auctions** when a purchase is declined, full rent tables
- Color-set double rent, railroads (25/50/100/200), utilities (4×/10× dice)
- Houses/hotels with even-build rule, selling back at half price
- Mortgage / unmortgage (+10% interest)
- Chance & Community Chest — all 32 classic cards, Get Out of Jail Free is holdable/tradeable
- Jail: roll doubles (3 tries), pay $50, or use a card
- **Trading**: properties + cash + jail cards between any players
- Debt flow: sell/mortgage to cover, or declare bankruptcy (assets go to the creditor)
- Win detection, disconnect/reconnect (refresh rejoins your seat)

## Optional asset drop-ins (game works without them)

| What | Where | Effect |
|---|---|---|
| Kabel-style font, renamed **kabel.ttf** | `assets/fonts/` | Authentic Monopoly typography |
| `dice.mp3` `cash.mp3` `card.mp3` `step.mp3` `jail.mp3` `build.mp3` `win.mp3` | `assets/sounds/` | Sound effects (mixkit.co / pixabay) |

## Tests

```
node test/rules.js    # deterministic rules engine tests
node test/smoke.js    # bots play a full random game (needs port 3155 free)
node test/visual.js   # screenshots the real UI via Edge (needs `npm start` on port 4000)
```

## Project layout

```
server/index.js   rooms, join codes, socket wiring
server/game.js    the rules engine (all game logic lives here)
shared/data.js    board tiles, rents, cards, tokens
public/           the client (no build step — plain ES modules)
assets/           board art extracted from the Figma Monopoly Kit + game-icons.net tokens
```
