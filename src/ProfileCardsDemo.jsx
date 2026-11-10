import "./ProfileCardsDemo.css";

function ProfileCard({ name, role, skills }) {
  return (
    <article className="profile-card">
      <h2>{name}</h2>
      <h3>{role}</h3>
      <ul>
        {skills.map((skill, index) => <li key={`${name}-${skill}-${index}`}>{skill}</li>)}
      </ul>
    </article>
  );
}

export default function ProfileCardsDemo() {
  return (
    <main className="profile-demo">
      <h1>Profile Cards</h1>
      <section className="profile-grid" aria-label="Developer profiles">
        <ProfileCard
          name="Chiru"
          role="Frontend Developer"
          skills={["HTML", "CSS", "React"]}
        />
        <ProfileCard
          name="Sai"
          role="Backend Developer"
          skills={["Python", "Java", "Node.js"]}
        />
      </section>
    </main>
  );
}
