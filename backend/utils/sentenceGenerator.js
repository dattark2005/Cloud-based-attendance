const ADJECTIVES = ['blue', 'green', 'bright', 'silent', 'fast', 'golden', 'white', 'calm', 'brave'];
const NOUNS = ['sky', 'ocean', 'mountain', 'forest', 'river', 'eagle', 'tiger', 'lion', 'cloud'];
const VERBS = ['shines', 'flows', 'runs', 'jumps', 'soars', 'glows', 'roars', 'leaps', 'stands'];

/**
 * Generate a random 3-4 word sentence for voice verification
 * @returns {string} Random sentence
 */
const generateVerificationSentence = () => {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const verb = VERBS[Math.floor(Math.random() * VERBS.length)];
    const num = Math.floor(Math.random() * 90) + 10; // 10-99

    return `${adj} ${noun} ${verb} ${num}`;
};

module.exports = {
    generateVerificationSentence,
};
