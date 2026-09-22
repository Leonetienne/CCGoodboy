# CC Good Boy

![The paw heading for a golden cookie during a Frenzy](https://raw.githubusercontent.com/Leonetienne/CCGoodboy/main/github-assets/hero.png)

A little paw that lives on your Cookie Clicker tab and catches golden cookies
while you're away. Leave it running overnight, come back to a fatter bank.
It also keeps your Grimoire busy whether you like it or not. If you want it
to, it will do your shopping and pop your wrinklers too. If you don't, it
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
  good one comes along. There's no off switch for this one: if you have a
  Grimoire, the bot will use it. Only Pause stops it.
- **Hurries up during Cookie Storms and chains**, because those don't wait for
  anyone.
- **Harvests your sugar lumps** as soon as they're ripe.

![A Cookie Storm, every cookie boxed, numbered and lined up for the paw](https://raw.githubusercontent.com/Leonetienne/CCGoodboy/main/github-assets/cookie-storm.png)

### Optional: full auto play

Hit the **Auto play** button and it turns into a full-service bot. It's off by
default and remembers your choice.

- Buys buildings and upgrades, picking the best deals first and saving up for
  the big stuff.
- Favours golden cookie upgrades and Wizard towers.
- Unlocks the Grimoire as soon as it can.
- Clicks the big cookie for you while that's still worth it.
- Takes the Grandmapocalypse to stage 1 for wrinklers, and **never** further.
  It pops fat wrinklers when it needs their cookies for a purchase. Shiny
  wrinklers are yours; it won't touch them.

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

![The CC Good Boy panel open with its stats and settings](https://raw.githubusercontent.com/Leonetienne/CCGoodboy/main/github-assets/menu-open.png)

| Button | What it's for |
|---|---|
| **Pause / Resume** | Stops and starts everything. |
| **Hammer cookie** | Click the big cookie nonstop, frenzy or not. Resets on reload. |
| **Auto play** | The shopping mode described above. |
| **Graphs** | Golden cookies caught per hour, by effect, plus Grimoire activity. |
| **Logs** | A diary of everything the bot did. You can search it and save a copy. |
| **Debug tools** | Cheats for testing. See below. |
| **Settings** | How patient, fast and fussy the paw is, what it shows on screen, and how auto play shops. Nothing changes until you hit **Save**. |

### Debug tools

These spawn golden cookies of any kind, hand you a quadrillion cookies, fill
your mana, give you sugar lumps, ripen your current lump, spawn wrinklers and
so on. They exist so you can watch the bot react without waiting hours for the
right cookie to show up.

**They change your save.** Use them on a test save. Seriously.

---

## Good to know

- **What it doesn't do:** seasons, the garden, the stock market, the pantheon,
  ascending, or anything beyond Grandmapocalypse stage 1.
- **Stage 1 has a cost.** With wrinklers around, one in three golden cookies
  turns into a wrath cookie, which the bot skips. The wrinklers more than make
  up for it, but if you'd rather not, switch off
  "Auto: grandmapocalypse stage 1" before turning auto play on. The bot can't
  undo stage 1 once it's reached.
- **Auto play is good, not perfect.** Try dry run first if you're unsure.
- Your settings and stats stay in your browser. Nothing is sent anywhere.
