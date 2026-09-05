# Skalito Animated

Componente isolado do Skalito animavel, criado sem dependencias externas para a arquitetura estatica atual do projeto.

## Uso

```html
<link rel="stylesheet" href="/components/skalito/skalito.css">
<link rel="stylesheet" href="/components/skalito/skalitoAnimations.css">
<script type="module" src="/components/skalito/SkalitoAnimated.js"></script>

<skalito-animated state="idle" look="center" size="120"></skalito-animated>
```

## API Publica

- `state`: `idle`, `thinking`, `talking`, `happy`, `alert`
- `look`: `center`, `left`, `right`, `up`, `down`
- `size`: numero em pixels

Metodos disponiveis no elemento:

- `setState(state)`
- `lookAt(look)`
- `wave()`
- `blink()`
- `point()`
- `celebrate()`
- `enter()`
- `exit()`

Estados ou direcoes invalidas voltam para `idle` e `center`.

## Restricoes

- As artes originais nao sao sobrescritas.
- As pecas usam `<image>` dentro de grupos SVG quando a vetorizacao completa nao e confiavel.
- Os IDs dos grupos animaveis sao estaveis: `wing-left`, `wing-right`, `tail`, `leg-left`, `leg-right`, `body-lower`, `arm-left`, `arm-right`, `body-upper`, `head`, `eye`.
- As animacoes usam principalmente `transform` e `opacity`.
- `prefers-reduced-motion` reduz loops continuos.
