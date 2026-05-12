module.exports = (allowedRoles = []) => {
  return async (req, res, next) => {
    const role = req.user?.role;
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
};
