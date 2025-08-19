/* global lottie */
(function () {
  const form = document.getElementById('qForm');
  const thanks = document.getElementById('thanks');
  const feelingsEl = document.getElementById('feelings');

  // Prepare Lottie animation (no loop, no autoplay)
  const animContainer = document.getElementById('thankyou-anim');
  const anim = lottie.loadAnimation({
    container: animContainer,
    renderer: 'svg',
    loop: false,          // <-- play once
    autoplay: false,      // <-- we will start it manually
    path: '/animations/thankyou.json'
  });

  let played = false;     // safety: ensure it only plays once per submit

  function showThankYouOnce() {
    if (played) return;
    played = true;
    thanks.style.display = 'block';
    anim.goToAndStop(0, true);
    anim.play();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const difficulty = (document.querySelector('input[name="difficulty"]:checked') || {}).value || null;
    const feelings = (feelingsEl.value || '').trim();

    if (!feelings) {
      alert('Please write a few sentences for question 2.');
      return;
    }

    try {
      // Call the frontend Node proxy (which forwards to the backend)
      const res = await fetch('/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty, feelings })
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Submit failed');
      }

      // Clear the form and show the one-time animation
      form.reset();
      showThankYouOnce();
    } catch (err) {
      console.error(err);
      alert('Sorry, something went wrong saving your response.');
    }
  });
})();
