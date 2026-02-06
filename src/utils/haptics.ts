// Haptic feedback utilities using the Vibration API

/**
 * Light haptic tap - for buttons
 */
export function hapticTap() {
  if ('vibrate' in navigator) {
    navigator.vibrate(10);
  }
}

/**
 * Medium haptic feedback - for card flip
 */
export function hapticFlip() {
  if ('vibrate' in navigator) {
    navigator.vibrate(15);
  }
}

/**
 * Success haptic pattern - for shuffle/reset
 */
export function hapticSuccess() {
  if ('vibrate' in navigator) {
    navigator.vibrate([10, 50, 10]);
  }
}
