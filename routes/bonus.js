router.post('/claim-bonus', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { firebaseUid } = req.body;
    const user = await User.findOne({ firebaseUid }).session(session);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const BONUS_AMOUNT = 50;
    const now = new Date();
    if (user.lastBonusClaim && (now - user.lastBonusClaim) < 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: `Already claimed today` });
    }

    await Earning.create([{ userId: user._id, firebaseUid, amount: BONUS_AMOUNT, type: 'bonus', description: `Daily bonus` }], { session });
    await Message.create([{ userId: user._id, firebaseUid, message: `You claimed ₦${BONUS_AMOUNT}`, type: 'earning' }], { session });

    user.wallet += BONUS_AMOUNT;
    await payReferralCommission(user, BONUS_AMOUNT, 'bonus', session);

    user.lastBonusClaim = now;
    await user.save({ session });

    await session.commitTransaction();
    res.json({ success: true, amount: BONUS_AMOUNT, newWallet: user.wallet });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
  }
});
