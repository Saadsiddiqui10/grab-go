# App journeys (Maestro)

Real taps on the real app in the iOS Simulator:

| Flow | Covers |
| --- | --- |
| `home-categories` | Category tabs show that category's cafés; tapping again clears it |
| `map-and-back` | Map list view, and Back from a map opened by link |
| `rewards` | Rewards grouped by café card |
| `order-curbside` | Café by link, add a drink, "bring to my car" refused without a plate, pay, confirmation with the plate |

## Running

Needs a booted simulator with the development build installed, Metro on
:8081 and the API on :4000 (the journeys use the development database and the
signed-in demo customer).

```bash
npm run test:app
```

Maestro needs Java 17+. On this Mac both live in `~/.local/opt` (no admin
install), so put them on the path first:

```bash
export JAVA_HOME=~/.local/opt/jdk-21.0.12.1+1/Contents/Home PATH="$JAVA_HOME/bin:$HOME/.local/opt/maestro/bin:$PATH"
```

`_launch.yaml` opens the development build from Metro; for a store build,
replace it with a plain `launchApp`. Café cards are single accessibility
elements ("Espresso Lab, Clifton. Open…"), so flows match them as prefixes.
