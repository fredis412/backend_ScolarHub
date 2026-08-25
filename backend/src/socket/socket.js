const { initSocket } = require('./socketHandler');

module.exports = (io) => {
  const connectedUsers = {};

  io.on('connection', (socket) => {
    console.log('Socket connecte : ' + socket.id);

    socket.on('auth', ({ userId }) => {
      connectedUsers[userId] = socket.id;
      socket.userId = userId;
    });

    socket.on('join_room', ({ roomId }) => socket.join(roomId));

    socket.on('private_message', ({ toUserId, message }) => {
      const target = connectedUsers[toUserId];
      if (target) io.to(target).emit('new_private_message', message);
    });

    socket.on('group_message', ({ roomId, message }) => {
      io.to(roomId).emit('new_group_message', message);
    });

    socket.on('canal_message', ({ canalId, message }) => {
      io.to('canal_' + canalId).emit('new_canal_message', message);
    });

    socket.on('admin_notification', ({ etablissementId, notification }) => {
      io.to('etablissement_' + etablissementId).emit('notification', notification);
    });

    socket.on('disconnect', () => {
      if (socket.userId) delete connectedUsers[socket.userId];
    });
  });

  // Jalil — Messagerie temps réel
  initSocket(io);
};
