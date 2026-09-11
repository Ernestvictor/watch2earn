    } catch (err) {
      console.warn('Session start error:', err);
      manualServerSessionOk = false;
    }

    if (claimBtn) {
      claimBtn.disabled = true;
      claimBtn.style.opacity = 0.65;
      claimBtn.innerText = 'Waiting...';
    }

    // start first ad + 60s
    if (adSlot) adSlot.innerHTML = '';
    showFirstBanner();
    let first = 60;
    setTimerText(first);
    if (localTimer) clearInterval(localTimer);
    localTimer = setInterval(() => {
      first -= 1; if (timerEl) timerEl.innerText = 'Ad1: ' + first + 's';
      if (first <= 0) {
        clearInterval(localTimer);
        if (adSlot) adSlot.innerHTML = '';
        showSecondAd();

        let second = 40;
        if (timerEl) timerEl.innerText = 'Ad2: ' + second + 's';
        localTimer = setInterval(() => {
          second -= 1; if (timerEl) timerEl.innerText = 'Ad2: ' + second + 's';
          if (second <= 0) {
            clearInterval(localTimer);
            manualSessionReady = true;
            if (claimBtn) {
              claimBtn.disabled = false;
              claimBtn.style.opacity = 1;
              claimBtn.innerText = 'Claim';
            }
            if (timerEl) timerEl.innerText = 'Ready to claim';
            try { alert('your bonus is ready to be claimed'); } catch(e){}
            try { pollStatus(); } catch (e) {}
          }
        }, 1000);
      }
    }, 1000);
  }

  if (startBtn) startBtn.addEventListener('click', handleStartClick);

  const refreshInterval = setInterval(refreshStartButton, 1500);
  refreshStartButton();

  if (window.__gameManualStartRefresh) clearInterval(window.__gameManualStartRefresh);
  window.__gameManualStartRefresh = refreshInterval;
});
</script>
