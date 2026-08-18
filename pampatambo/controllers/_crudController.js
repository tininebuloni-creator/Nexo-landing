// controllers/_crudController.js
// Factory: dado un modelo, devuelve handlers Express con CRUD básico.
module.exports = function crud(model, opts = {}) {
  const { allowedFields = null } = opts;

  const pick = (body) => {
    const safeBody = (body && typeof body === 'object') ? body : {};
    if (!allowedFields) return safeBody;
    const out = {};
    for (const k of allowedFields) if (safeBody[k] !== undefined) out[k] = safeBody[k];
    return out;
  };

  return {
    index: (req, res, next) => {
      try { res.json(model.list(req.query)); } catch (e) { next(e); }
    },
    show: (req, res, next) => {
      try {
        const row = model.find(req.params.id);
        if (!row) return res.status(404).json({ error: 'No encontrado' });
        res.json(row);
      } catch (e) { next(e); }
    },
    create: (req, res, next) => {
      try { res.status(201).json(model.create(pick(req.body))); } catch (e) { next(e); }
    },
    update: (req, res, next) => {
      try { res.json(model.update(req.params.id, pick(req.body))); } catch (e) { next(e); }
    },
    remove: (req, res, next) => {
      try { model.remove(req.params.id); res.status(204).end(); } catch (e) { next(e); }
    },
  };
};
