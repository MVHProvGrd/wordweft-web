// Firebase configuration for WordWeft
const firebaseConfig = {
    apiKey: "AIzaSyALA1vtSVAdQ7Z9-HaBV62yeI1iq0ceesI",
    authDomain: "wordweft-game.firebaseapp.com",
    databaseURL: "https://wordweft-game-default-rtdb.firebaseio.com",
    projectId: "wordweft-game",
    storageBucket: "wordweft-game.firebasestorage.app",
    messagingSenderId: "888094194021",
    appId: "1:888094194021:android:fa58f1453fcce1c9ad898c"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
const db = firebase.database();
