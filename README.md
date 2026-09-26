![The paw catching a golden cookie and celebrating afterwards](https://raw.githubusercontent.com/Leonetienne/CCGoodboy/refs/heads/master/github-assets/peace.gif)

# CC Good Boy

![The paw heading for a golden cookie during a Frenzy](https://raw.githubusercontent.com/Leonetienne/CCGoodboy/refs/heads/master/github-assets/hero.png)

A little paw that lives on your Cookie Clicker tab and catches golden cookies
while you're away. Leave it running overnight, come back to a fatter bank.
It also keeps your Grimoire busy, unless you tell it not to.
If you want to, it will do your shopping and pop your wrinklers too. If you don't, it
won't touch either.

> **This is an experimental project.** It's a fun project, it might have some bugs or imperfections,
> and some features are younger than others. Create a backup before letting it loose on your safegame.

---

## What it does

Out of the box, CC Good Boy is a golden cookie hunter. That's the core of it
and the part that's been around the longest.

- **Catches every good golden cookie.** Wrath cookies are left alone. When a
  bunch show up at once, it sweeps them all up.
- **Plays like a person.** You'll see the paw move and click like someone is
  actually sitting there.
- **Goes wild on the big cookie during Click Frenzy.**
- **Keeps your Force the Hand of Fate combo going.** It casts the spell when a
  combo is worth it, and spends a sugar lump to refill your mana when a really
  good one comes along. Don't want that? Untick **Grimoire: cast Force the
  Hand of Fate** in the settings, or untick **Spend sugar lumps** to keep
  casting but never spend a lump.
- **Hurries up during Cookie Storms and chains**, because those don't wait for
  anyone.
- **Harvests your sugar lumps** as soon as they're ripe.

![A Cookie Storm, every cookie boxed, numbered and lined up for the paw](https://raw.githubusercontent.com/Leonetienne/CCGoodboy/refs/heads/master/github-assets/cookie-storm.png)

### Optional: full auto play

Hit the **Auto play** button and it turns into a full-service bot. It's off by
default and remembers your choice.

- Buys buildings and upgrades, picking the best deals first and saving up for
  the big stuff.
- Favours golden cookie upgrades and Wizard towers.
- Unlocks the Grimoire as soon as it can (that costs a sugar lump, so not
  with **Spend sugar lumps** off).
- Clicks the big cookie for you while that's still worth it.
- Takes the Grandmapocalypse to stage 1 for wrinklers **if you want to**, and **never** further.
  It pops fat wrinklers when it needs their cookies for a purchase. Shiny
  wrinklers are yours; it won't touch them.
- Raises Krumblor, the cookie dragon, once you have the crumbly egg: it pays
  the egg levels when they're pocket change, sacrifices 100 of each building
  from cursors to shipments (selling the extras first and buying them back
  after, which is much cheaper) and puts on the **Dragonflight** aura. It never swaps out an aura you picked
  yourself. Switch it off with **Auto: train Krumblor**.
- At Christmas it catches reindeer like golden cookies, buys the festive
  hat, Santa's gifts and the reindeer biscuits, and evolves Santa all the way to **Final Claus**.

Not sure you trust it with your cookies? Turn on **dry run** and it'll only
write down what it *would* have bought.

### "How good is a buy" scores

Even with auto play off, every building and upgrade in the store gets a
coloured box and a score from 0 to 100. Green is the best deal on offer right
now, red is the worst. Handy if you'd rather do the buying yourself and just
want a second opinion.

### When there's nothing to do

The paw doesn't just freeze. It doodles slow figure-eights, wanders over to
look at your buildings, reads the news ticker, occasionally pokes the big
cookie out of boredom. It does a little happy dance after a catch. Some days
it's shy and runs off if your mouse gets too close; other days it doesn't care.
Click near it when it's in a good mood and see what happens.

None of this gets in your way. You can keep using your own mouse as normal.

---

## Installing

1. Add [Tampermonkey](https://www.tampermonkey.net/) to your browser. It's a
   free browser extension that lets little add-ons like this one run on
   websites.
2. Go to the [Releases page](https://github.com/Leonetienne/CCGoodboy/releases)
   and click the newest `cc-good-boy.user.js`. Tampermonkey opens and asks if
   you want to install it. Click **Install**.
3. Open [Cookie Clicker](https://orteil.dashnet.org/cookieclicker/). After a
   second or so the CC Good Boy panel appears.

That's it. It starts hunting golden cookies straight away.

### Leaving it in the background

CC Good Boy keeps playing while you're on another tab. Click anywhere on the
game once after it loads so it can keep going at full speed. If a little
speaker icon shows up on the tab, that's normal. You won't hear anything.

---

## Getting around

The panel can be dragged by its title bar and minimised. From there:

![The CC Good Boy panel open with its stats and settings](https://raw.githubusercontent.com/Leonetienne/CCGoodboy/refs/heads/master/github-assets/menu-open.png)

| Button | What it's for |
|---|---|
| **Pause / Resume** | Stops and starts everything. |
| **Hammer cookie** | Click the big cookie nonstop, frenzy or not. Resets on reload. |
| **Auto play** | The shopping mode described above. |
| **Settings** | What the paw does and shows on screen, and how auto play shops. The fine-tuning (timings, speeds, auto play's numbers) sits under **Advanced**. Nothing changes until you hit **Save**. |
| **More...** | Opens a second row with the buttons below. |
| **Graphs** | Golden cookies caught per hour, by effect, plus Grimoire activity. |
| **Logs** | A diary of everything the bot did. You can search it and save a copy. |
| **Debug tools** | Cheats for testing. See below. Hidden until you tick **Settings → Advanced → Show debug tools**. |

The panel's rarely needed rows (buffs, LOCK_A, click cooldown, background) are folded under **Details**.

### Debug tools

Switch them on under **Settings → Advanced → Show debug tools**; the button then shows up under **More...**.
These spawn golden cookies of any kind, hand you a quadrillion cookies, fill
your mana, give you sugar lumps, ripen your current lump, spawn wrinklers, unlock Krumblor or the
Christmas upgrades and so on. They exist so you can watch the bot react without waiting hours for the
right cookie to show up.

**They change your save.** Use them on a test save. Seriously.

---

## Good to know

- **What it doesn't do:** seasons, the pantheon, the stock market's offices
  and loans, breeding new garden seeds on purpose, or anything beyond
  Grandmapocalypse stage 1.
- **The garden.** With "Tend the garden" on (the default), the paw keeps the
  Farm's garden full of Baker's wheat (+1% CpS each), harvests plants before
  they wither, weeds out pests and uses clay once you have 100 farms. It
  never plants during a buff (seeds cost more then) and never spends a sugar
  lump on the garden, except that auto play unlocks it (Farm level 1).
- **Ascending.** The "Ascension" row and the box on the Legacy button tell
  you when ascending pays off and which heavenly upgrades to buy. With auto
  play on, the bot also ascends by itself; untick "Auto: ascend" in the auto
  play settings if you'd rather do that part yourself.
- **Stage 1 has a cost.** With wrinklers around, one in three golden cookies
  turns into a wrath cookie, which the bot skips. The wrinklers more than make
  up for it, but if you'd rather not, switch off
  "Auto: grandmapocalypse stage 1" before turning auto play on. The bot can't
  undo stage 1 once it's reached.
- **Auto play is good, not perfect.** Try dry run first if you're unsure.
- Your settings and stats stay in your browser. Nothing is sent anywhere.

---

## Nerd stuff

Want to build it yourself or poke around the code? Here's how.

CC Good Boy is written in TypeScript and gets bundled into one single
Tampermonkey script. You don't need Node on your machine. Everything runs
inside Docker, so Docker is the only thing you have to install.

```bash
make build
```

That spits out `dist/cc-good-boy.user.js`. Open Tampermonkey, create a new
script, paste the contents in and save. Or point Tampermonkey at the file.
Done.

A few more things you can run:

| Command | What it does |
|---|---|
| `make dev` | Rebuilds automatically every time you save a file. |
| `make test` | Runs the unit tests. |
| `make typecheck` | Checks the TypeScript types without building. |
| `make shell` | Drops you into a shell inside the build container. |
| `make clean` | Throws away the cached `node_modules` volume. |

The first run takes a moment because it builds the Docker image. After
that it's quick.

If you want to know how the bot thinks, [AGENTS.md](AGENTS.md) has all of
it: every behaviour written down as a requirement, how the code is laid out,
and a changelog going back to version 2.
