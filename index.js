const fs = require("fs");
const Gitlab = require("@gitbeaker/node").Gitlab;
const results = require("./result.json") || {};
const config = require("./config.json");
const users = {};
const api = new Gitlab(config);
const getUserInfo = async function (user) {
  const key = user.username;
  const name = user.name;
  console.log("begin fetch events:", key);

  const data = (results[key] && results[key].data) || {
    push_count: 0,
    commit_count: 0,
    commit_line: 0,
    mr_open_count: 0, // 合并代码最多
    mr_merged_count: 0, // 合并代码最多
    issues_open_count: 0, // 提问题最多
    issues_close_count: 0, // 提问题最多
  };
  // 如果之前的数据没跑过这块
  if (
    !results[key] ||
    (results[key] && !results[key].data.hasOwnProperty("mr_open_count"))
  ) {
    // 跑 issues 数据
    const events = await api.Users.events(key, {
      after: new Date(config.startDate),
      target_type: "issue",
    });
    events.forEach((event) => {
      if (event.action_name == "opened") {
        data.issues_open_count += 1;
      } else if (event.action_name == "closed") {
        data.issues_close_count += 1;
      }
    });
    // 跑 pr 数据
    const mr_events = await api.Users.events(key, {
      after: new Date(config.startDate),
      target_type: "merge_request",
    });
    mr_events.forEach((event) => {
      if (event.action_name == "opened") {
        data.mr_open_count += 1;
      } else if (event.action_name == "merged") {
        data.mr_merged_count += 1;
      }
    });
  }

  if (results[key]) {
    console.log("exist");
    // fs.writeFileSync('./result.json',JSON.stringify(results,null,2));
    // 下面这些数据跑过就不跑了
    return;
  }
  const events = await api.Users.events(key, {
    after: new Date(config.startDate),
    // target_type: 'commented',
  });

  function timeout(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  console.log("begin fetch events:", events.length);
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    const commit_ids = [];
    if ((event.action_name = "pushed to")) {
      data.push_count += 1;
      var push_data = event.push_data;
      if (push_data) {
        data.commit_count += push_data.commit_count;
        if (push_data.commit_count > 1) {
          // await timeout(10);
          const compare_result = await api.Repositories.compare(
            event.project_id,
            push_data.commit_from,
            push_data.commit_to
          );
          const commits = compare_result.commits;
          commits.forEach((c) => {
            commit_ids.push(c.id);
          });
        } else {
          push_data.commit_to && commit_ids.push(push_data.commit_to);
          push_data.commit_from && commit_ids.push(push_data.commit_from);
        }
      }
      console.log("begin fetch commits:", commit_ids.length);
      for (
        var commit_index = 0;
        commit_index < commit_ids.length;
        commit_index++
      ) {
        var commit_id = commit_ids[commit_index];
        // await timeout(10);
        try {
          const commit_info = await api.Commits.show(
            event.project_id,
            commit_id
          );
          const stats = commit_info.stats;
          data.commit_line += stats.additions;
        } catch (e) {
          console.log(e);
          console.log(event, commit_id);
        }
      }
    }
  }
  results[key] = {
    data: data,
    user: user,
  };
  // console.log(results);
  fs.writeFileSync("./result.json", JSON.stringify(results, null, 2));
};

const run = async function () {
  const all_users = await api.Users.all();
  for (var i = 0; i < all_users.length; i++) {
    var user = all_users[i];
    if (user.state == "active") {
      users[user.name] = {
        username: user.username,
        email: user.email,
        name: user.name,
      };
    }
  }
  console.log("begin run users:", Object.keys(users).length);
  for (const name in users) {
    try {
      await getUserInfo(users[name]);
    } catch (e) {
      console.log(e);
      console.log("抓取错误：", users[name]);
    }
  }
  console.log(results);
};
run();
