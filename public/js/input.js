class InputManager {
  constructor(onInputChange, onBombPress) {
    this.onInputChange = onInputChange;
    this.onBombPress = onBombPress;

    this.state = {
      up: false,
      down: false,
      left: false,
      right: false,
    };

    this.initKeyboard();
    this.initTouch();
  }

  updateState(key, val) {
    if (this.state[key] !== val) {
      this.state[key] = val;
      if (this.onInputChange) {
        this.onInputChange({ ...this.state });
      }
    }
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      // 入力フォームでの入力中はゲーム操作を無効化
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        return;
      }

      let handled = true;
      switch (e.code) {
        case 'ArrowUp':
        case 'KeyW':
          this.updateState('up', true);
          break;
        case 'ArrowDown':
        case 'KeyS':
          this.updateState('down', true);
          break;
        case 'ArrowLeft':
        case 'KeyA':
          this.updateState('left', true);
          break;
        case 'ArrowRight':
        case 'KeyD':
          this.updateState('right', true);
          break;
        case 'Space':
        case 'KeyJ':
          if (!e.repeat && this.onBombPress) {
            this.onBombPress();
          }
          break;
        default:
          handled = false;
          break;
      }

      if (handled) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        return;
      }

      switch (e.code) {
        case 'ArrowUp':
        case 'KeyW':
          this.updateState('up', false);
          break;
        case 'ArrowDown':
        case 'KeyS':
          this.updateState('down', false);
          break;
        case 'ArrowLeft':
        case 'KeyA':
          this.updateState('left', false);
          break;
        case 'ArrowRight':
        case 'KeyD':
          this.updateState('right', false);
          break;
      }
    });
  }

  initTouch() {
    const dpadBtns = document.querySelectorAll('.dpad-btn');
    dpadBtns.forEach((btn) => {
      const dir = btn.getAttribute('data-dir');
      if (!dir) return;

      const setDir = (active) => {
        this.updateState(dir, active);
        if (active) {
          btn.classList.add('pressed');
        } else {
          btn.classList.remove('pressed');
        }
      };

      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        setDir(true);
      }, { passive: false });

      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        setDir(false);
      }, { passive: false });

      btn.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        setDir(false);
      }, { passive: false });

      // マウス操作もサポート
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        setDir(true);
      });
      btn.addEventListener('mouseup', (e) => {
        e.preventDefault();
        setDir(false);
      });
      btn.addEventListener('mouseleave', (e) => {
        setDir(false);
      });
    });

    const bombBtn = document.getElementById('mobileBombBtn');
    if (bombBtn) {
      const handleBomb = (e) => {
        e.preventDefault();
        if (this.onBombPress) {
          this.onBombPress();
        }
      };

      bombBtn.addEventListener('touchstart', handleBomb, { passive: false });
      bombBtn.addEventListener('click', handleBomb);
    }
  }
}

window.InputManager = InputManager;
