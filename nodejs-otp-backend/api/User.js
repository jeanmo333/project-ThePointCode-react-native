const express = require("express");
const router = express.Router();

// mongodb user model
const User = require("./../models/User");

// mongodb user verification model
const UserVerification = require("./../models/UserVerification");

// mongodb user otp verification model
const UserOTPVerification = require("./../models/UserOTPVerification");

// mongodb user model
const PasswordReset = require("./../models/PasswordReset");

// email handler
const nodemailer = require("nodemailer");

// unique string
const { v4: uuidv4 } = require("uuid");

// Password handler
const bcrypt = require("bcrypt");

// Env variables
require("dotenv").config();

// path for static verified page
const path = require("path");

// Nodemailer stuff
let transporter = nodemailer.createTransport({
  host: "smtp-mail.outlook.com",
  auth: {
    user: process.env.AUTH_EMAIL,
    pass: process.env.AUTH_PASS,
  },
});

// testing success
transporter.verify((error, success) => {
  if (error) {
    console.log(error);
  } else {
    console.log("Ready for messages");
    console.log(success);
  }
});

// setting sever url
const development = "http://localhost:5000/";
const production = "https://radiant-meadow-44726.herokuapp.com/";
const currentUrl = process.env.NODE_ENV ? production : development;

// Signup
router.post("/signup", (req, res) => {
  let { name, email, password, dateOfBirth } = req.body;
  name = name.trim();
  email = email.trim();
  password = password.trim();
  dateOfBirth = dateOfBirth.trim();

  if (name == "" || email == "" || password == "" || dateOfBirth == "") {
    res.json({
      status: "FAILED",
      message: "Empty input fields!",
    });
  } else if (!/^[a-zA-Z ]*$/.test(name)) {
    res.json({
      status: "FAILED",
      message: "Invalid name entered",
    });
  } else if (!/^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/.test(email)) {
    res.json({
      status: "FAILED",
      message: "Invalid email entered",
    });
  } else if (!new Date(dateOfBirth).getTime()) {
    res.json({
      status: "FAILED",
      message: "Invalid date of birth entered",
    });
  } else if (password.length < 8) {
    res.json({
      status: "FAILED",
      message: "Password is too short!",
    });
  } else {
    // Checking if user already exists
    User.find({ email })
      .then((result) => {
        if (result.length) {
          // A user already exists
          res.json({
            status: "FAILED",
            message: "User with the provided email already exists",
          });
        } else {
          // Try to create new user

          // password handling
          const saltRounds = 10;
          bcrypt
            .hash(password, saltRounds)
            .then((hashedPassword) => {
              const newUser = new User({
                name,
                email,
                password: hashedPassword,
                dateOfBirth,
                verified: false,
              });

              newUser
                .save()
                .then((result) => {
                  // Handle account verification
                  // sendVerificationEmail(result, res);
                  sendOTPVerificationEmail(result, res);
                })
                .catch((err) => {
                  console.log(err);
                  res.json({
                    status: "FAILED",
                    message: "An error occurred while saving user account!",
                  });
                });
            })
            .catch((err) => {
              res.json({
                status: "FAILED",
                message: "An error occurred while hashing password!",
              });
            });
        }
      })
      .catch((err) => {
        console.log(err);
        res.json({
          status: "FAILED",
          message: "An error occurred while checking for existing user!",
        });
      });
  }
});

// send otp verification email
const sendOTPVerificationEmail = async ({ _id, email }, res) => {
  try {
    const otp = `${Math.floor(1000 + Math.random() * 9000)}`;

    // mail options
    const mailOptions = {
      from: process.env.AUTH_EMAIL,
      to: email,
      subject: "Verify Your Email",
      html: `<p>Enter <b>${otp}</b> in the app to verify your email address and complete the signup process.</p><p>This code <b>expires in 1 hour</b>.</p>`,
    };

    // hash the otp
    const saltRounds = 10;

    const hashedOTP = await bcrypt.hash(otp, saltRounds);
    const newOTPVerification = await new UserOTPVerification({
      userId: _id,
      otp: hashedOTP,
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    });
    // save otp record
    await newOTPVerification.save();
    await transporter.sendMail(mailOptions);
    res.json({
      status: "PENDING",
      message: "Verification otp email sent",
      data: {
        userId: _id,
        email,
      },
    });
  } catch (error) {
    res.json({
      status: "FAILED",
      message: error.message,
    });
  }
};

// Verify otp email
router.post("/verifyOTP", async (req, res) => {
  try {
    let { userId, otp } = req.body;
    if (!userId || !otp) {
      throw Error("Empty otp details are not allowed");
    } else {
      const UserOTPVerificationRecords = await UserOTPVerification.find({
        userId,
      });
      if (UserOTPVerificationRecords.length <= 0) {
        // no record found
        throw new Error(
          "Account record doesn't exist or has been verified already. Please sign up or log in."
        );
      } else {
        // user otp record exists
        const { expiresAt } = UserOTPVerificationRecords[0];
        const hashedOTP = UserOTPVerificationRecords[0].otp;

        if (expiresAt < Date.now()) {
          // user otp record has expired
          await UserOTPVerification.deleteMany({ userId });
          throw new Error("Code has expired. Please request again.");
        } else {
          const validOTP = await bcrypt.compare(otp, hashedOTP);

          if (!validOTP) {
            // supplied otp is wrong
            throw new Error("Invalid code passed. Check your inbox.");
          } else {
            // success
            await User.updateOne({ _id: userId }, { verified: true });
            await UserOTPVerification.deleteMany({ userId });
            res.json({
              status: "VERIFIED",
              message: `User email verified successfully.`,
            });
          }
        }
      }
    }
  } catch (error) {
    res.json({
      status: "FAILED",
      message: error.message,
    });
  }
});

// resend verification
router.post("/resendOTPVerificationCode", async (req, res) => {
  try {
    let { userId, email } = req.body;

    if (!userId || !email) {
      throw Error("Empty user details are not allowed");
    } else {
      // delete existing records and resend
      await UserOTPVerification.deleteMany({ userId });
      sendOTPVerificationEmail({ _id: userId, email }, res);
    }
  } catch (error) {
    res.json({
      status: "FAILED",
      message: error.message,
    });
  }
});

// send verification email
const sendVerificationEmail = ({ _id, email }, res) => {
  const uniqueString = uuidv4() + _id;

  // mail options
  const mailOptions = {
    from: process.env.AUTH_EMAIL,
    to: email,
    subject: "Verify Your Email",
    html: `<p>Verify your email address to complete the signup and login into your account.</p><p>This link <b>expires in 6 hours</b>.</p><p>Press <a href=${
      currentUrl + "user/verify/" + _id + "/" + uniqueString
    }>here</a> to proceed.</p>`,
  };

  // hash the uniqueString
  const saltRounds = 10;
  bcrypt
    .hash(uniqueString, saltRounds)
    .then((hashedUniqueString) => {
      // set values in userVerification collection
      const newVerification = new UserVerification({
        userId: _id,
        uniqueString: hashedUniqueString,
        createdAt: Date.now(),
        expiresAt: Date.now() + 21600000,
      });

      newVerification
        .save()
        .then(() => {
          transporter
            .sendMail(mailOptions)
            .then(() => {
              // email sent and verification record saved.
              res.json({
                status: "PENDING",
                message: "Verification email sent",
                data: {
                  userId: _id,
                  email,
                },
              });
            })
            .catch((err) => {
              res.json({
                status: "FAILED",
                message: "Verification email failed",
              });
              console.log(err);
            });
        })
        .catch((error) => {
          console.log(error);
          res.json({
            status: "FAILED",
            message: "Couldn't save verification email data",
          });
        });
    })
    .catch(() => {
      res.json({
        status: "FAILED",
        message: "An error occurred while hashing email data!",
      });
    });
};

// resend verification
router.post("/resendVerificationLink", async (req, res) => {
  try {
    let { userId, email } = req.body;

    if (!userId || !email) {
      throw Error("Empty user details are not allowed");
    } else {
      // delete existing records and resend
      await UserVerification.deleteMany({ userId });
      sendVerificationEmail({ _id: userId, email }, res);
    }
  } catch (error) {
    res.json({
      status: "FAILED",
      message: `Verification Link Resend Error. ${error.message}`,
    });
  }
});

// Verify email
router.get("/verify/:userId/:uniqueString", (req, res) => {
  let { userId, uniqueString } = req.params;

  UserVerification.find({ userId })
    .then((result) => {
      if (result.length > 0) {
        // user verification record exists so we proceed

        const { expiresAt } = result[0];
        const hashedUniqueString = result[0].uniqueString;

        // checking for expired unique string
        if (expiresAt < Date.now()) {
          UserVerification.deleteOne({ userId })
            .then((result) => {
              // delete expired user
              User.deleteOne({ _id: userId })
                .then(() => {
                  let message = "Link has expired. Please sign up again.";
                  res.redirect(`/user/verified?error=true&message=${message}`);
                })
                .catch((error) => {
                  console.log(error);
                  let message =
                    "Clearing user with expired unique string failed.";
                  res.redirect(`/user/verified?error=true&message=${message}`);
                });
            })
            .catch((error) => {
              // deletion failed
              console.log(error);
              let message =
                "An error occurred while clearing expired user verification record";
              res.redirect(`/user/verified?error=true&message=${message}`);
            });
        } else {
          // valid record exists so we validate the user string
          // First compare the hashed unique string

          bcrypt
            .compare(uniqueString, hashedUniqueString)
            .then((result) => {
              if (result) {
                // Strings match

                User.updateOne({ _id: userId }, { verified: true })
                  .then(() => {
                    UserVerification.deleteOne({ userId })
                      .then(() => {
                        res.sendFile(
                          path.join(__dirname, "./../views/verified.html")
                        );
                      })
                      .catch((error) => {
                        console.log(error);
                        let message =
                          "An error occurred while finalizing successful verification.";
                        res.redirect(
                          `/user/verified?error=true&message=${message}`
                        );
                      });
                  })
                  .catch((error) => {
                    console.log(error);
                    let message =
                      "An error occurred while updating user record to show verified.";
                    res.redirect(
                      `/user/verified?error=true&message=${message}`
                    );
                  });
              } else {
                // Existing record but incorrect verification details passed.
                let message =
                  "Invalid verification details passed. Check your inbox.";
                res.redirect(`/user/verified?error=true&message=${message}`);
              }
            })
            .catch((err) => {
              let message = "An error occurred while comparing unique strings.";
              res.redirect(`/user/verified?error=true&message=${message}`);
            });
        }
      } else {
        // user verification record doesn't exist
        let message =
          "Account record doesn't exist or has been verified already. Please sign up or log in.";
        res.redirect(`/user/verified?error=true&message=${message}`);
      }
    })
    .catch((error) => {
      console.log(error);
      let message =
        "An error occurred while checking for existing user verification record";
      res.redirect(`/user/verified?error=true&message=${message}`);
    });
});

// Verified page route
router.get("/verified", (_, res) => {
  res.sendFile(path.join(__dirname, `./../views/verified.html`));
});

// Signin
router.post("/signin", (req, res) => {
  let { email, password } = req.body;
  email = email.trim();
  password = password.trim();

  if (email == "" || password == "") {
    res.json({
      status: "FAILED",
      message: "Empty credentials supplied",
    });
  } else {
    // Check if user exist
    User.find({ email })
      .then((data) => {
        if (data.length) {
          // User exists

          // check if user is verified

          if (!data[0].verified) {
            res.json({
              status: "FAILED",
              message: "Email hasn't been verified yet. Check your inbox.",
            });
          } else {
            // email is verified so we check password

            const hashedPassword = data[0].password;
            bcrypt
              .compare(password, hashedPassword)
              .then((result) => {
                if (result) {
                  // Password match
                  res.json({
                    status: "SUCCESS",
                    message: "Signin successful",
                    data: data,
                  });
                } else {
                  res.json({
                    status: "FAILED",
                    message: "Invalid password entered!",
                  });
                }
              })
              .catch((err) => {
                res.json({
                  status: "FAILED",
                  message: "An error occurred while comparing passwords",
                });
              });
          }
        } else {
          res.json({
            status: "FAILED",
            message: "Invalid credentials entered!",
          });
        }
      })
      .catch((err) => {
        res.json({
          status: "FAILED",
          message: "An error occurred while checking for existing user",
        });
      });
  }
});

// Password reset stuff
router.post("/requestPasswordReset", (req, res) => {
  const { email, redirectUrl } = req.body;

  // check if email exists.
  User.find({ email })
    .then((data) => {
      if (data.length) {
        // User exists

        // check if user is verified

        if (!data[0].verified) {
          res.json({
            status: "FAILED",
            message: "Email hasn't been verified yet. Check your inbox.",
          });
        } else {
          // email is proceed with reset request
          // prepare password reset token

          sendResetEmail(data[0], redirectUrl, res);
        }
      } else {
        res.json({
          status: "FAILED",
          message: "No account with the supplied email exists!",
        });
      }
    })
    .catch((err) => {
      res.json({
        status: "FAILED",
        message: "An error occurred while checking for existing user",
      });
      console.log(err);
    });
});

// send password reset email
const sendResetEmail = ({ _id, email }, redirectUrl, res) => {
  const resetString = uuidv4() + _id;

  // First, we clear all existing reset records
  PasswordReset.deleteMany({ userId: _id })
    .then((result) => {
      // Reset records deleted successfully
      // Now we send the email

      // mail options
      const mailOptions = {
        from: process.env.AUTH_EMAIL,
        to: email,
        subject: "Password Reset",
        html: `<p>We heard that you lost your password.</p> <p> Don't worry, use the link below to reset it.</p> <p> This link <b>expires in 60 minutes</b>. </p> <p>Press <a href=${
          redirectUrl + "/" + _id + "/" + resetString
        }>here</a> to proceed.</p>`,
      };

      // hash the resetString
      const saltRounds = 10;
      bcrypt
        .hash(resetString, saltRounds)
        .then((hashedResetString) => {
          // set values in password reset collection
          const newPasswordReset = new PasswordReset({
            userId: _id,
            resetString: hashedResetString,
            createdAt: Date.now(),
            expiresAt: Date.now() + 3600000,
          });

          newPasswordReset
            .save()
            .then(() => {
              transporter
                .sendMail(mailOptions)
                .then(() => {
                  // reset email sent and password reset record saved.
                  res.json({
                    status: "PENDING",
                    message: "Password reset email sent",
                  });
                })
                .catch((err) => {
                  res.json({
                    status: "FAILED",
                    message: "Password reset email failed",
                  });
                  console.log(err);
                });
            })
            .catch((error) => {
              console.log(error);
              res.json({
                status: "FAILED",
                message: "Couldn't save password reset data",
              });
            });
        })
        .catch(() => {
          res.json({
            status: "FAILED",
            message: "An error occurred while hashing password reset data!",
          });
        });
    })
    .catch((error) => {
      // Error while clearing existing records
      console.log(error);
      res.json({
        status: "FAILED",
        message: "Clearing existing password reset records failed.",
      });
    });
};

// Actually reset password
router.post("/resetPassword", (req, res) => {
  let { userId, resetString, newPassword } = req.body;

  PasswordReset.find({ userId })
    .then((result) => {
      if (result.length > 0) {
        // password reset record exists so we proceed

        const { expiresAt } = result[0];
        const hashedResetString = result[0].resetString;

        // checking for expired reset string
        if (expiresAt < Date.now()) {
          PasswordReset.deleteOne({ userId })
            .then((result) => {
              // Reset record deleted successfully
              res.json({
                status: "FAILED",
                message: "Password reset link has expired.",
              });
            })
            .catch((error) => {
              // deletion failed
              console.log(error);
              res.json({
                status: "FAILED",
                message: "Clearing password reset record failed.",
              });
            });
        } else {
          // valid reset record exists so we validate the reset string
          // First compare the hashed reset string

          bcrypt
            .compare(resetString, hashedResetString)
            .then((result) => {
              if (result) {
                // Strings match
                // Hash password again

                const saltRounds = 10;
                bcrypt
                  .hash(newPassword, saltRounds)
                  .then((hashedNewPassword) => {
                    // update user password record

                    User.updateOne(
                      { _id: userId },
                      { password: hashedNewPassword }
                    )
                      .then(() => {
                        // Update complete. Now delete reset record
                        PasswordReset.deleteOne({ userId })
                          .then(() => {
                            // both user record and reset record updated
                            res.json({
                              status: "SUCCESS",
                              message: "Password has been reset successfully.",
                            });
                          })
                          .catch((error) => {
                            console.log(error);
                            res.json({
                              status: "FAILED",
                              message:
                                "An error occurred while finalizing password reset.",
                            });
                          });
                      })
                      .catch((error) => {
                        console.log(error);
                        res.json({
                          status: "FAILED",
                          message: "Updating user password failed.",
                        });
                      });
                  })
                  .catch((error) => {
                    console.log(error);
                    res.json({
                      status: "FAILED",
                      message: "An error occurred while hashing new password.",
                    });
                  });
              } else {
                // Existing record but incorrect reset string passed.

                res.json({
                  status: "FAILED",
                  message: "Invalid password reset details passed.",
                });
              }
            })
            .catch((err) => {
              res.json({
                status: "FAILED",
                message: "Comparing password reset strings failed",
              });
            });
        }
      } else {
        // Password reset record doesn't exist
        res.json({
          status: "FAILED",
          message: "Password reset request not found.",
        });
      }
    })
    .catch((error) => {
      console.log(error);
      res.json({
        status: "FAILED",
        message: "Checking for existing password reset record failed.",
      });
    });
});

module.exports = router;
