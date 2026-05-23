exports.createAuditLog = async (db, payload) => {
  return db.collection('auditLogs').add({
    ...payload,
    createdAt: new Date().toISOString()
  });
};
