import gsap from 'https://cdn.skypack.dev/gsap@3.13.0'
import Draggable from 'https://cdn.skypack.dev/gsap@3.13.0/Draggable'
import { Pane } from 'https://cdn.skypack.dev/tweakpane@4.0.4'

gsap.registerPlugin(Draggable)

const toggle = document.querySelector('.liquid-toggle')
const config = {
  theme: 'dark',
  complete: 0,
  active: false,
  deviation: 13,
  alpha: 13,
  bounce: true,
  hue: 144,
  delta: true,
  bubble: true,
  mapped: false,
  debug: true,
}

const ctrl = new Pane({
  title: 'config',
})

const update = () => {
  gsap.set('#goo feGaussianBlur', {
    attr: {
      stdDeviation: config.deviation,
    },
  })
  gsap.set('#goo feColorMatrix', {
    attr: {
      values: `
        1 0 0 0 0
        0 1 0 0 0
        0 0 1 0 0
        0 0 0 ${config.alpha} -10
      `,
    },
  })
  document.documentElement.dataset.theme = config.theme
  document.documentElement.dataset.mapped = config.mapped
  document.documentElement.dataset.delta = config.delta
  document.documentElement.dataset.debug = config.debug
  document.documentElement.dataset.active = config.active
  document.documentElement.dataset.bounce = config.bounce
  toggle.style.setProperty('--complete', config.complete)
  toggle.style.setProperty('--hue', config.hue)
}

const sync = (event) => {
  if (
    !document.startViewTransition ||
    event.target.controller.view.labelElement.innerText !== 'theme'
  )
    return update()
  document.startViewTransition(() => update())
}

const debugSettings = ctrl.addFolder({ title: 'debug', expanded: false })

debugSettings.addBinding(config, 'debug')
debugSettings.addBinding(config, 'active')
debugSettings.addBinding(config, 'complete', {
  min: 0,
  max: 100,
  label: 'complete (%)',
  step: 1,
})

const behaviorSettings = ctrl.addFolder({ title: 'behavior', expanded: false })
behaviorSettings.addBinding(config, 'bounce')
behaviorSettings.addBinding(config, 'mapped')
behaviorSettings.addBinding(config, 'bubble')
behaviorSettings.addBinding(config, 'delta')
behaviorSettings.addBinding(config, 'hue', {
  min: 0,
  max: 359,
  step: 1,
})
const settings = ctrl.addFolder({
  title: 'filter',
  disabled: false,
  expanded: false,
})
settings.addBinding(config, 'deviation', {
  min: 0,
  max: 50,
  step: 1,
  label: 'stdDeviation',
})
settings.addBinding(config, 'alpha', {
  min: 0,
  max: 50,
  step: 1,
  label: 'alpha',
})
ctrl.addBinding(config, 'theme', {
  label: 'theme',
  options: {
    system: 'system',
    light: 'light',
    dark: 'dark',
  },
})

ctrl.on('change', sync)
update()

const toggleState = async () => {
  toggle.dataset.pressed = true
  if (config.bubble) toggle.dataset.active = true
  await Promise.allSettled(
    !config.bounce
      ? toggle.getAnimations({ subtree: true }).map((a) => a.finished)
      : []
  )
  const pressed = toggle.matches('[aria-pressed=true]')
  gsap
    .timeline({
      onComplete: () => {
        gsap.delayedCall(0.05, () => {
          toggle.dataset.active = false
          toggle.dataset.pressed = false
          toggle.setAttribute(
            'aria-pressed',
            !toggle.matches('[aria-pressed=true]')
          )
        })
      },
    })
    .to(toggle, {
      '--complete': pressed ? 0 : 100,
      duration: 0.12,
      delay: config.bounce && config.bubble ? 0.18 : 0,
    })
}

const proxy = document.createElement('div')
Draggable.create(proxy, {
  allowContextMenu: true,
  handle: '.liquid-toggle',
  onDragStart: function () {
    const toggleBounds = toggle.getBoundingClientRect()
    const pressed = toggle.matches('[aria-pressed=true]')
    const bounds = pressed
      ? toggleBounds.left - this.pointerX
      : toggleBounds.left + toggleBounds.width - this.pointerX
    this.dragBounds = bounds
    toggle.dataset.active = true
  },
  onDrag: function () {
    const pressed = toggle.matches('[aria-pressed=true]')
    const dragged = this.x - this.startX
    const complete = gsap.utils.clamp(
      0,
      100,
      pressed
        ? gsap.utils.mapRange(this.dragBounds, 0, 0, 100, dragged)
        : gsap.utils.mapRange(0, this.dragBounds, 0, 100, dragged)
    )
    this.complete = complete
    gsap.set(toggle, { '--complete': complete, '--delta': Math.min(Math.abs(this.deltaX), 12) })
  },
  onDragEnd: function () {
    gsap.fromTo(
      toggle,
      {
        '--complete': this.complete,
      },
      {
        '--complete': this.complete >= 50 ? 100 : 0,
        duration: 0.15,
        onComplete: () => {
          gsap.delayedCall(0.05, () => {
            toggle.dataset.active = false
            toggle.setAttribute('aria-pressed', this.complete >= 50)
          })
        },
      }
    )
  },
  onPress: function () {
    this.__pressTime = Date.now()
    const arrowMain = document.querySelector('.arrow--main')
    if (arrowMain) arrowMain.style.setProperty('opacity', 0)
    if ('ontouchstart' in window && navigator.maxTouchPoints > 0)
      toggle.dataset.active = true
  },
  onRelease: function () {
    this.__releaseTime = Date.now()
    gsap.set(toggle, { '--delta': 0 })
    if (
      'ontouchstart' in window &&
      navigator.maxTouchPoints > 0 &&
      ((this.startX !== undefined &&
        this.endX !== undefined &&
        Math.abs(this.endX - this.startX) < 4) ||
        this.endX === undefined)
    )
      toggle.dataset.active = false
    if (this.__releaseTime - this.__pressTime <= 150) {
      toggleState()
    }
  },
})

toggle.addEventListener('keydown', (e) => {
  const arrowMain = document.querySelector('.arrow--main')
  if (arrowMain) arrowMain.style.setProperty('opacity', 0)
  if (e.key === 'Enter') {
    toggleState()
  }

  if (e.key === ' ') {
    e.preventDefault()
  }
})

toggle.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    toggleState()
  }
})

const tweakClass = 'div.tp-dfwv'
const d = Draggable.create(tweakClass, {
  type: 'x,y',
  allowEventDefault: true,
  trigger: tweakClass + ' button.tp-rotv_b',
})
const tweakElement = document.querySelector(tweakClass)
if (tweakElement) {
  tweakElement.addEventListener('dblclick', () => {
    gsap.to(tweakClass, {
      x: `+=${d[0].x * -1}`,
      y: `+=${d[0].y * -1}`,
      onComplete: () => {
        gsap.set(tweakClass, { clearProps: 'all' })
      },
    })
  })
}

